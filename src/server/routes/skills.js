const fs = require("fs");
const path = require("path");
const os = require("os");
const { sendJSON } = require("../utils");

/**
 * Parses simple YAML frontmatter from a markdown string.
 */
function parseSkillMarkdown(content) {
    let name = "";
    let description = "";
    let body = content;

    if (content.startsWith("---")) {
        const endIdx = content.indexOf("---", 3);
        if (endIdx !== -1) {
            const header = content.slice(3, endIdx).trim();
            body = content.slice(endIdx + 3).trim();
            for (const line of header.split("\n")) {
                const colon = line.indexOf(":");
                if (colon > 0) {
                    const key = line.slice(0, colon).trim().toLowerCase();
                    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
                    if (key === "name") name = val;
                    if (key === "description") description = val;
                }
            }
        }
    }

    return { name, description, body };
}

/**
 * Scans a directory for skill folders containing SKILL.md.
 */
function scanSkillsDirectory(baseDir, source) {
    const skills = [];
    if (!fs.existsSync(baseDir)) return skills;

    try {
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            const skillFilePath = path.join(baseDir, ent.name, "SKILL.md");
            if (fs.existsSync(skillFilePath)) {
                try {
                    const rawContent = fs.readFileSync(skillFilePath, "utf8");
                    const { name, description } = parseSkillMarkdown(rawContent);
                    skills.push({
                        id: ent.name,
                        name: name || ent.name,
                        description: description || "No description provided",
                        source,
                        dirPath: path.join(baseDir, ent.name),
                        filePath: skillFilePath
                    });
                } catch (readErr) {
                    console.error(`[SKILLS] Failed to read ${skillFilePath}:`, readErr.message);
                }
            }
        }
    } catch (err) {
        console.error(`[SKILLS] Failed to scan ${baseDir}:`, err.message);
    }

    return skills;
}

/**
 * Returns aggregated list of all available skills.
 * Defaults to ~/.agents/skills and project .agents/skills.
 */
function getAllSkills() {
    const globalDir = path.join(os.homedir(), ".agents", "skills");
    const workspaceDir = path.join(process.cwd(), ".agents", "skills");

    const globalSkills = scanSkillsDirectory(globalDir, "global");
    const workspaceSkills = scanSkillsDirectory(workspaceDir, "workspace");

    // Merge with workspace skills taking precedence on id collision
    const map = new Map();
    for (const s of globalSkills) {
        map.set(s.id, s);
    }
    for (const s of workspaceSkills) {
        map.set(s.id, s);
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Route handler for /api/skills
 */
async function handleSkillsRoute(req, res) {
    const urlObj = new URL(req.url, "http://localhost");
    const pathname = urlObj.pathname;

    // GET /api/skills/content?id=...
    if (pathname === "/api/skills/content") {
        const skillId = urlObj.searchParams.get("id");
        if (!skillId) {
            return sendJSON(res, 400, { error: "Missing required 'id' query parameter" });
        }

        const safeId = path.basename(skillId);
        const all = getAllSkills();
        const found = all.find(s => s.id === safeId);

        if (!found || !fs.existsSync(found.filePath)) {
            return sendJSON(res, 404, { error: `Skill '${safeId}' not found` });
        }

        try {
            const raw = fs.readFileSync(found.filePath, "utf8");
            const { name, description, body } = parseSkillMarkdown(raw);
            return sendJSON(res, 200, {
                id: found.id,
                name: name || found.name,
                description: description || found.description,
                content: raw,
                body: body,
                source: found.source,
                filePath: found.filePath,
                dirPath: found.dirPath
            });
        } catch (err) {
            return sendJSON(res, 500, { error: `Failed to load skill: ${err.message}` });
        }
    }

    // GET /api/skills - List all skills
    if (pathname === "/api/skills") {
        const skills = getAllSkills().map(s => ({
            id: s.id,
            name: s.name,
            description: s.description,
            source: s.source,
            filePath: s.filePath,
            dirPath: s.dirPath
        }));
        return sendJSON(res, 200, { skills });
    }

    return sendJSON(res, 404, { error: "Not found" });
}

module.exports = {
    handleSkillsRoute,
    getAllSkills
};

