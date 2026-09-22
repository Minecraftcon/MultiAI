/**
 * services/deepsearch/manager.js
 * ==============================
 * Background Job Manager for MultiAI DeepSearch.
 * Decouples autonomous search jobs from HTTP request lifetimes so jobs
 * persist and run in server background even if the browser/tab is closed.
 */

const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");

class DeepSearchManager extends EventEmitter {
    constructor() {
        super();
        this.jobs = new Map();
    }

    /**
     * Create and register a new DeepSearch background job.
     * @param {Object} params
     * @param {string} params.chatId
     * @param {string} params.topic
     * @param {string} [params.plan]
     * @param {string} [params.model]
     * @param {string} params.artifactDir
     * @returns {Object} job
     */
    createJob({ chatId, topic, plan = "", model = "gemini-2.5-flash", artifactDir }) {
        const jobId = `ds-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const safeName = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "research";
        const jobArtifactDir = path.join(artifactDir, `Deepsearch-${safeName}`);

        // Ensure directories exist
        if (!fs.existsSync(jobArtifactDir)) {
            fs.mkdirSync(jobArtifactDir, { recursive: true });
        }
        const agentsDir = path.join(jobArtifactDir, "Agents");
        if (!fs.existsSync(agentsDir)) {
            fs.mkdirSync(agentsDir, { recursive: true });
        }

        const job = {
            id: jobId,
            chatId,
            topic,
            safeName,
            plan,
            model,
            artifactDir: jobArtifactDir,
            status: "queued", // queued, planning, searching, digging, reviewing, summarizing, completed, failed
            phase: "Initializing",
            progress: 0,
            statusText: "Starting Research...",
            stats: {
                sourcesFound: 0,
                sourcesDug: 0,
                agentsActive: 0,
                agentsTotal: 4
            },
            logs: [],
            finalReportPath: path.join(jobArtifactDir, "final_report.md"),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            error: null
        };

        this.jobs.set(jobId, job);
        this.emit("job:created", job);
        return job;
    }

    /**
     * Get job by ID.
     * @param {string} jobId
     * @returns {Object|null}
     */
    getJob(jobId) {
        return this.jobs.get(jobId) || null;
    }

    /**
     * Find active or latest job for a specific chat.
     * @param {string} chatId
     * @returns {Object|null}
     */
    getJobByChatId(chatId) {
        if (!chatId) return null;
        let latest = null;
        for (const job of this.jobs.values()) {
            if (job.chatId === chatId) {
                if (!latest || job.createdAt > latest.createdAt) {
                    latest = job;
                }
            }
        }
        return latest;
    }

    /**
     * Update job progress, phase, and logs.
     * @param {string} jobId
     * @param {Object} updates
     */
    updateJob(jobId, updates = {}) {
        const job = this.jobs.get(jobId);
        if (!job) return;

        if (updates.status) job.status = updates.status;
        if (updates.phase) job.phase = updates.phase;
        if (typeof updates.progress === "number") job.progress = Math.min(100, Math.max(0, updates.progress));
        if (updates.statusText) job.statusText = updates.statusText;
        if (updates.stats) job.stats = { ...job.stats, ...updates.stats };
        if (updates.error) job.error = updates.error;
        if (updates.finalReport) job.finalReport = updates.finalReport;

        if (updates.log) {
            const entry = {
                timestamp: Date.now(),
                text: updates.log,
                type: updates.logType || "info"
            };
            job.logs.push(entry);
            // Cap logs at 200 items in memory
            if (job.logs.length > 200) job.logs.shift();
        }

        job.updatedAt = Date.now();

        // Write snapshot to disk in job artifact dir
        try {
            const metaPath = path.join(job.artifactDir, "job_status.json");
            fs.writeFileSync(metaPath, JSON.stringify({
                id: job.id,
                chatId: job.chatId,
                topic: job.topic,
                status: job.status,
                phase: job.phase,
                progress: job.progress,
                statusText: job.statusText,
                stats: job.stats,
                updatedAt: job.updatedAt,
                error: job.error
            }, null, 2));
        } catch (e) {
            // Ignore write errors
        }

        this.emit("job:updated", job);
    }
}

const deepSearchManager = new DeepSearchManager();

module.exports = deepSearchManager;
