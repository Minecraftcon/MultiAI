/**
 * MultiAI Cloud Supabase Storage Adapter
 * ======================================
 * Provides permanent cloud persistence for chats, messages, and artifacts.
 * Automatically synchronizes with Supabase Postgres.
 */

const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const os = require("os");

let pool = null;
let isInitialized = false;

function getSupabaseConfig() {
    let password = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_PASSWORD || "";
    if (!password) {
        const passFile = path.join(os.homedir(), ".supabase_db_pass");
        if (fs.existsSync(passFile)) {
            try {
                password = fs.readFileSync(passFile, "utf8").trim();
            } catch (_) {}
        }
    }

    // Default to configured host or fallback to environment variables
    const host = process.env.SUPABASE_DB_HOST || "";
    let user = process.env.SUPABASE_DB_USER || "postgres";
    const port = parseInt(process.env.SUPABASE_DB_PORT || "5432", 10);
    const database = process.env.SUPABASE_DB_NAME || "postgres";

    if (!password || !host) return null;

    return {
        host,
        port,
        user,
        password,
        database,
        ssl: { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000
    };
}

function getPool() {
    if (!pool) {
        const config = getSupabaseConfig();
        if (config) {
            pool = new Pool(config);
            pool.on("error", (err) => {
                console.error("[SUPABASE POOL ERROR]", err.message);
            });
        }
    }
    return pool;
}

async function isConnected() {
    const p = getPool();
    if (!p) return false;
    try {
        const res = await p.query("SELECT 1;");
        return res.rowCount === 1;
    } catch (e) {
        return false;
    }
}

/**
 * Save or update chat session metadata and messages in Supabase
 */
async function saveChat(chatSession) {
    const p = getPool();
    if (!p || !chatSession || !chatSession.id) return null;

    const id = chatSession.id;
    const title = chatSession.title || "New Chat";
    const type = chatSession.type || "chat";
    const projectId = chatSession.projectId || null;
    const dateFolder = chatSession.date || new Date().toISOString().slice(0, 10);
    const msgCount = Array.isArray(chatSession.messages)
        ? chatSession.messages.length
        : (chatSession.messageCount || chatSession.meta?.messageCount || 0);
    const meta = {
        title,
        createdAt: chatSession.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        date: dateFolder,
        type,
        projectId,
        messageCount: msgCount,
        ...(chatSession.meta || {})
    };

    const client = await p.connect();
    try {
        await client.query("BEGIN;");

        // 1. Upsert chat record
        await client.query(`
            INSERT INTO public.chats (id, title, type, project_id, date_folder, meta, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                type = EXCLUDED.type,
                project_id = EXCLUDED.project_id,
                date_folder = EXCLUDED.date_folder,
                meta = EXCLUDED.meta,
                updated_at = NOW();
        `, [id, title, type, projectId, dateFolder, JSON.stringify(meta)]);

        // 2. If messages array is provided, replace / refresh messages
        if (Array.isArray(chatSession.messages)) {
            await client.query("DELETE FROM public.chat_messages WHERE chat_id = $1;", [id]);

            for (const msg of chatSession.messages) {
                const role = msg.role || "user";
                const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content || "");
                await client.query(`
                    INSERT INTO public.chat_messages (chat_id, role, content, data, created_at)
                    VALUES ($1, $2, $3, $4, $5);
                `, [id, role, content, JSON.stringify(msg), msg.timestamp ? new Date(msg.timestamp) : new Date()]);
            }
        }

        await client.query("COMMIT;");
        return { success: true, id, cloud: true };
    } catch (err) {
        await client.query("ROLLBACK;");
        console.error("[SUPABASE SAVE CHAT ERROR]", err.message);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Append a single message to an existing chat in Supabase
 */
async function appendChatMessage(chatId, message) {
    const p = getPool();
    if (!p || !chatId || !message) return null;

    const role = message.role || "user";
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content || "");

    const client = await p.connect();
    try {
        await client.query("BEGIN;");

        // Ensure parent chat record exists in public.chats before inserting message
        await client.query(`
            INSERT INTO public.chats (id, title, type, date_folder, updated_at)
            VALUES ($1, 'Conversation', 'chat', TO_CHAR(NOW(), 'YYYY-MM-DD'), NOW())
            ON CONFLICT (id) DO UPDATE SET updated_at = NOW();
        `, [chatId]);

        await client.query(`
            INSERT INTO public.chat_messages (chat_id, role, content, data, created_at)
            VALUES ($1, $2, $3, $4, $5);
        `, [chatId, role, content, JSON.stringify(message), message.timestamp ? new Date(message.timestamp) : new Date()]);

        await client.query("COMMIT;");
        return { success: true, cloud: true };
    } catch (err) {
        await client.query("ROLLBACK;");
        console.error("[SUPABASE APPEND ERROR]", err.message);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Retrieve chat metadata and all messages from Supabase
 */
async function getChat(chatId) {
    const p = getPool();
    if (!p || !chatId) return null;

    const chatRes = await p.query("SELECT * FROM public.chats WHERE id = $1;", [chatId]);
    if (chatRes.rows.length === 0) return null;

    const chatRow = chatRes.rows[0];
    const msgRes = await p.query(
        "SELECT * FROM public.chat_messages WHERE chat_id = $1 ORDER BY id ASC;",
        [chatId]
    );

    const messages = msgRes.rows.map(r => r.data);
    const meta = chatRow.meta || {};

    return {
        id: chatRow.id,
        title: chatRow.title,
        date: chatRow.date_folder,
        type: chatRow.type,
        projectId: chatRow.project_id,
        meta,
        messages
    };
}

/**
 * List all chats ordered by most recently updated
 */
async function listChats() {
    const p = getPool();
    if (!p) return null;

    const res = await p.query(`
        SELECT c.id, c.title, c.type, c.project_id, c.date_folder, c.updated_at, c.created_at, c.meta,
               COUNT(m.id)::int AS msg_count
        FROM public.chats c
        LEFT JOIN public.chat_messages m ON m.chat_id = c.id
        GROUP BY c.id, c.title, c.type, c.project_id, c.date_folder, c.updated_at, c.created_at, c.meta
        ORDER BY c.updated_at DESC
        LIMIT 100;
    `);

    return res.rows.map(row => {
        const count = (row.msg_count !== undefined && row.msg_count !== null && row.msg_count > 0)
            ? row.msg_count
            : (row.meta?.messageCount || 0);
        return {
            id: row.id,
            title: row.title,
            date: row.date_folder,
            type: row.type,
            projectId: row.project_id,
            updatedAt: row.updated_at,
            createdAt: row.created_at,
            messageCount: count,
            source: "supabase",
            meta: {
                ...(row.meta || {}),
                messageCount: count
            }
        };
    });
}

/**
 * Delete a single chat from Supabase (messages cascade delete)
 */
async function deleteChat(chatId) {
    const p = getPool();
    if (!p || !chatId) return false;

    const res = await p.query("DELETE FROM public.chats WHERE id = $1 RETURNING id;", [chatId]);
    return res.rowCount > 0;
}

/**
 * Delete all chats
 */
async function deleteAllChats() {
    const p = getPool();
    if (!p) return 0;

    const res = await p.query("DELETE FROM public.chats;");
    return res.rowCount;
}

/**
 * Save an artifact file to Supabase
 */
async function saveArtifact({ chatId, filePath, fileType = "text", mimeType = "text/plain", contentText = "", contentBase64 = "", sizeBytes = 0 }) {
    const p = getPool();
    if (!p || !filePath) return null;

    const artifactId = `${chatId || "global"}:${filePath}`;
    await p.query(`
        INSERT INTO public.artifacts (id, chat_id, file_path, file_type, mime_type, content_text, content_base64, size_bytes, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (id) DO UPDATE SET
            file_type = EXCLUDED.file_type,
            mime_type = EXCLUDED.mime_type,
            content_text = EXCLUDED.content_text,
            content_base64 = EXCLUDED.content_base64,
            size_bytes = EXCLUDED.size_bytes,
            updated_at = NOW();
    `, [artifactId, chatId || null, filePath, fileType, mimeType, contentText, contentBase64, sizeBytes]);

    return { id: artifactId, filePath, cloud: true };
}

/**
 * Get an artifact file from Supabase
 */
async function getArtifact(chatId, filePath) {
    const p = getPool();
    if (!p || !filePath) return null;

    const artifactId = `${chatId || "global"}:${filePath}`;
    const res = await p.query("SELECT * FROM public.artifacts WHERE id = $1;", [artifactId]);
    if (res.rows.length === 0) return null;

    return res.rows[0];
}

/**
 * Fetch all encrypted/secure secrets from private.secrets and populate process.env
 * Safe from HTTP PostgREST API exposure (in private schema).
 */
async function loadSecretsIntoEnv() {
    const p = getPool();
    if (!p) return 0;
    try {
        const res = await p.query("SELECT key, value FROM private.secrets;");
        let count = 0;
        for (const row of res.rows) {
            if (!process.env[row.key]) {
                process.env[row.key] = row.value;
                count++;
            }
        }
        if (count > 0) {
            console.log(`[SECRETS] Loaded ${count} API keys from Supabase private vault.`);
        }
        return count;
    } catch (err) {
        console.warn("[SECRETS] Could not load secrets from Supabase:", err.message);
        return 0;
    }
}

module.exports = {
    getSupabaseConfig,
    isConnected,
    loadSecretsIntoEnv,
    saveChat,
    appendChatMessage,
    getChat,
    listChats,
    deleteChat,
    deleteAllChats,
    saveArtifact,
    getArtifact
};
