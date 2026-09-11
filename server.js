const http = require("http");
const fs = require("fs");
const path = require("url");

const PORT = 8080;
const TINYFISH_API_KEY = process.env.TINYFISH_API_KEY;
const LOG_FILE = "./logs.txt";

if (!TINYFISH_API_KEY) {
    console.error("ERROR: TINYFISH_API_KEY is not set.");
    console.error("Run:");
    console.error("export TINYFISH_API_KEY='your-key'");
    process.exit(1);
}

// Flush the log file on every server restart.
fs.writeFileSync(LOG_FILE, `--- log started ${new Date().toISOString()} ---\n`);

function logToFile(tag, data) {
    const entry = {
        timestamp: new Date().toISOString(),
        tag,
        ...data
    };
    fs.appendFile(LOG_FILE, JSON.stringify(entry) + "\n", (err) => {
        if (err) console.error("[LOG WRITE ERROR]", err);
    });
}

async function tinyfishSearch(args) {
    const query = String(args.query || "").trim();

    if (!query) {
        throw new Error("Search query is empty");
    }

    const url = new URL("https://api.search.tinyfish.ai");

    url.searchParams.set("query", query);

    if (args.location) {
        url.searchParams.set("location", args.location);
    }

    if (args.language) {
        url.searchParams.set("language", args.language);
    }

    if (args.page !== undefined) {
        url.searchParams.set("page", String(args.page));
    }

    const response = await fetch(url, {
        headers: {
            "X-API-Key": TINYFISH_API_KEY
        }
    });

    const text = await response.text();

    if (!response.ok) {
        throw new Error(
            `TinyFish HTTP ${response.status}: ${text}`
        );
    }

    return JSON.parse(text);
}

function sendJSON(res, status, data) {
    const body = JSON.stringify(data);

    res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Access-Control-Allow-Origin": "*"
    });

    res.end(body);
}

const server = http.createServer(async (req, res) => {

    // CORS
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        });
        return res.end();
    }

    // Client-side event logging (chat responses, errors, tool activity)
    if (req.method === "POST" && req.url === "/api/log") {
        try {
            let body = "";
            for await (const chunk of req) {
                body += chunk;
            }
            const data = JSON.parse(body || "{}");
            logToFile(data.tag || "CLIENT", data);
            return sendJSON(res, 200, { ok: true });
        } catch (error) {
            console.error("[LOG ENDPOINT ERROR]", error);
            return sendJSON(res, 500, { error: error.message });
        }
    }

    // TinyFish search proxy
    if (req.method === "POST" && req.url === "/api/search") {

        try {
            let body = "";

            for await (const chunk of req) {
                body += chunk;
            }

            const args = JSON.parse(body || "{}");

            console.log("[SEARCH]", args.query);
            logToFile("SEARCH_REQUEST", { query: args.query, args });

            const result = await tinyfishSearch(args);

            logToFile("SEARCH_RESPONSE", {
                query: args.query,
                total_results: result?.total_results,
                result_count: Array.isArray(result?.results) ? result.results.length : null,
                raw: result
            });

            return sendJSON(res, 200, result);

        } catch (error) {

            console.error("[SEARCH ERROR]", error);
            logToFile("SEARCH_ERROR", { message: error.message });

            return sendJSON(res, 500, {
                error: error.message
            });
        }
    }

    // Serve frontend
    if (req.method === "GET") {

        let file = req.url === "/" ? "/index.html" : req.url;

        // Basic path protection
        if (file.includes("..")) {
            res.writeHead(400);
            return res.end("Bad request");
        }

        const filePath = "." + file;

        fs.readFile(filePath, (err, data) => {

            if (err) {
                res.writeHead(404);
                return res.end("Not found");
            }

            const type =
                file.endsWith(".html")
                    ? "text/html"
                    : file.endsWith(".js")
                    ? "text/javascript"
                    : file.endsWith(".css")
                    ? "text/css"
                    : "application/octet-stream";

            res.writeHead(200, {
                "Content-Type": type
            });

            res.end(data);
        });

        return;
    }

    res.writeHead(404);
    res.end("Not found");
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
