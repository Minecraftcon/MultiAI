/**
 * Badge Synchronization & UI Presentation for Tool Executions
 */

/**
 * Initializes visual timers and indicators on tool badge start.
 */
export function onToolStart(name, args, badgeEl) {
    if (!badgeEl) return;

    if (name === "run_task") {
        const cooldown = Math.max(1, parseInt(args.timer || args.timeout, 10) || 5);
        const ringBar = badgeEl.querySelector(".timer-ring-bar");
        if (ringBar) {
            ringBar.style.transition = "none";
            ringBar.style.strokeDashoffset = "108.39";
            void ringBar.getBoundingClientRect();
            ringBar.style.transition = `stroke-dashoffset ${cooldown}s linear`;
            ringBar.style.strokeDashoffset = "0";
        }
    }

    if (name === "schedule") {
        const cooldown = Math.max(0.1, parseFloat(args.time ?? args.sleep_time ?? args.seconds ?? 5) || 5);
        const ringBar = badgeEl.querySelector(".timer-ring-bar");
        if (ringBar) {
            ringBar.style.transition = "none";
            ringBar.style.strokeDashoffset = "108.39";
            void ringBar.getBoundingClientRect();
            ringBar.style.transition = `stroke-dashoffset ${cooldown}s linear`;
            ringBar.style.strokeDashoffset = "0";
        }
    }
}

/**
 * Updates badge indicators and collapse panel output upon completion.
 */
export function onToolComplete(name, args, badgeEl, data) {
    if (!badgeEl) return;

    if (name === "run_task" || name === "schedule") {
        const ringBar = badgeEl.querySelector(".timer-ring-bar");
        if (ringBar) {
            ringBar.style.transition = "stroke-dashoffset 0.15s ease, stroke 0.3s ease";
            ringBar.style.strokeDashoffset = "0";
        }
        badgeEl.classList.add("timer-finished");

        if (name === "schedule" && data) {
            const labelEl = badgeEl.querySelector(".search-label");
            const queryEl = badgeEl.querySelector(".search-query");
            if (data.status === "task_completed") {
                if (labelEl) labelEl.textContent = "Task completed";
                if (queryEl) queryEl.textContent = `${data.task_id || args.task || "task"} exited in ${data.elapsed_seconds}s (code: ${data.exit_code ?? 0})`;
            } else if (data.status === "task_output") {
                if (labelEl) labelEl.textContent = "Task output";
                if (queryEl) queryEl.textContent = `${data.task_id || args.task || "task"} emitted output in ${data.elapsed_seconds}s`;
            } else {
                if (labelEl) labelEl.textContent = name === "schedule" ? "Scheduled timer" : "Timer hit";
                const taskDesc = args.task ? ` for ${args.task}` : "";
                const elapsed = data.elapsed_seconds ?? args.time ?? args.seconds ?? 5;
                if (queryEl) queryEl.textContent = `${elapsed}s cooldown completed${taskDesc}`;
            }
        }
    }

    if ((name === "replace_file_content" || name === "multi_replace_file_content") && data) {
        const queryEl = badgeEl.querySelector(".search-query");
        if (queryEl) {
            const diffSign = (data.lines_diff !== undefined && data.lines_diff >= 0) ? `+${data.lines_diff}` : `${data.lines_diff || 0}`;
            queryEl.textContent = `${data.path || "file"} (${diffSign} lines)`;
        }
    }

    if (name === "grep_search" && data) {
        const queryEl = badgeEl.querySelector(".search-query");
        if (queryEl) {
            const count = data.total_matches !== undefined ? `${data.total_matches} match${data.total_matches === 1 ? '' : 'es'}` : (data.total_files !== undefined ? `${data.total_files} file${data.total_files === 1 ? '' : 's'}` : "");
            const queryTerm = args.Query !== undefined ? args.Query : (args.query || args.pattern || "");
            if (count) {
                queryEl.textContent = `"${queryTerm}" (${count})`;
            }
        }
    }

    // Format output in collapse div if present
    if (badgeEl._collapseDiv && data) {
        const resEl = badgeEl._collapseDiv.querySelector(".command-output-res");
        if (resEl) {
            let outText = "";
            const isLarge = data.is_large_output || (data.stdout && data.stdout.split("\n").length > 150);
            if (isLarge && (name === "run_task" || name === "manage_tasks")) {
                const rawOutput = data.truncated_lines || data.stdout || "";
                const lines = rawOutput.split("\n").slice(-150);
                const indentedLines = lines.map(l => "      " + l).join("\n");
                outText = `id: ${data.task_id || args.task_id || "task"}\n`;
                if (data.stderr && data.stderr.trim()) {
                    outText += `stderr: [output truncated ... showing last 150 lines]\n${indentedLines}\n`;
                } else {
                    outText += `stdout: [output truncated ... showing last 150 lines]\n${indentedLines}\n`;
                }
                outText += `status_code: ${data.exit_code ?? 0}\n`;
                outText += `ran_for: ${data.ran_for || data.elapsed_seconds || "1.0"}s\n`;
                outText += `sys: output has been saved to ${data.scratch_log_path || `scratch/${args.task_name ? (args.task_name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') + '-') : ''}${data.task_id || 'task'}.log`}`;
            } else if (name === "run_task" || name === "manage_tasks") {
                outText = `id: ${data.task_id || args.task_id || "task"}\n`;
                if (data.stdout && data.stdout.trim()) {
                    outText += `stdout:\n${data.stdout.split("\n").map(l => "      " + l).join("\n")}\n`;
                }
                if (data.stderr && data.stderr.trim()) {
                    outText += `stderr:\n${data.stderr.split("\n").map(l => "      " + l).join("\n")}\n`;
                }
                outText += `status_code: ${data.exit_code ?? 0}\n`;
                outText += `ran_for: ${data.ran_for || data.elapsed_seconds || "1.0"}s\n`;
                if (data.scratch_log_path) {
                    outText += `sys: log saved to ${data.scratch_log_path}`;
                }
            } else if (name === "read_file") {
                if (data.type === "image") {
                    outText = `[Image: ${data.path} (${data.mime || "image"}, ${data.human_size || ""})]\n${data.markdown || ""}`;
                    if (data.data_url && badgeEl._collapseDiv) {
                        let imgPreview = badgeEl._collapseDiv.querySelector(".tool-image-preview");
                        if (!imgPreview) {
                            imgPreview = document.createElement("img");
                            imgPreview.className = "tool-image-preview";
                            imgPreview.style.maxWidth = "100%";
                            imgPreview.style.maxHeight = "320px";
                            imgPreview.style.borderRadius = "8px";
                            imgPreview.style.marginTop = "10px";
                            imgPreview.style.display = "block";
                            imgPreview.style.objectFit = "contain";
                            imgPreview.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
                            badgeEl._collapseDiv.appendChild(imgPreview);
                        }
                        imgPreview.src = data.data_url;
                    }
                } else if (data.content !== undefined) {
                    outText = data.content || (data.entries ? JSON.stringify(data.entries, null, 2) : "(Empty file or directory)");
                } else if (data.message || data.note || data.status || data.error) {
                    outText = data.message || data.note || data.error || data.status;
                } else {
                    outText = JSON.stringify(data, null, 2);
                }
            } else if (name === "write_file") {
                outText = data.message || JSON.stringify(data, null, 2);
            } else if (name === "replace_file_content" || name === "multi_replace_file_content" || name === "search_and_replace") {
                const diffSection = data.diff ? `\n\n${data.diff}` : "";
                outText = (data.message || `Edited ${data.path || "file"}`) + diffSection;
            } else if (name === "grep_search") {
                const engine = data.engine || data.engine_used || "ripgrep";
                const trunc = data.is_truncated ? " (capped at 50 results)" : "";
                if (data.matches && Array.isArray(data.matches)) {
                    outText = `Found ${data.total_matches ?? data.matches.length} match(es) [${engine}]${trunc}:\n` +
                        data.matches.map(m => `${m.filename || m.file}:${m.line_number}: ${m.line_content}`).join("\n");
                } else if (data.files && Array.isArray(data.files)) {
                    outText = `Found ${data.total_files ?? data.files.length} file(s) [${engine}]${trunc}:\n` +
                        data.files.join("\n");
                } else {
                    outText = JSON.stringify(data, null, 2);
                }
            } else if (name === "generate_image" || name === "get_image_status") {
                if (data.background || data.status === "in_progress" || data.status === "running") {
                    outText = `[Image Generation In Progress (Task ID: ${data.task_id})]\n${data.prompt || data.message || "Generating in background..."}`;
                } else {
                    const imgData = data.result || data;
                    outText = `[Image Generated: ${imgData.model || "flux"} (${imgData.dimensions?.width || 1024}x${imgData.dimensions?.height || 1024})]\n${imgData.markdown || (imgData.url ? `![](${imgData.url})` : "")}\nDirect URL: ${imgData.url || ""}`;
                    if (imgData.url && badgeEl._collapseDiv) {
                        let imgPreview = badgeEl._collapseDiv.querySelector(".tool-image-preview");
                        if (!imgPreview) {
                            imgPreview = document.createElement("img");
                            imgPreview.className = "tool-image-preview";
                            imgPreview.style.maxWidth = "100%";
                            imgPreview.style.maxHeight = "320px";
                            imgPreview.style.borderRadius = "8px";
                            imgPreview.style.marginTop = "10px";
                            imgPreview.style.display = "block";
                            imgPreview.style.objectFit = "contain";
                            imgPreview.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
                            badgeEl._collapseDiv.appendChild(imgPreview);
                        }
                        imgPreview.src = imgData.url;
                    }
                }
            } else if (name === "manage_tasks") {
                if (data.status === "task_completed" || (typeof data.status === "string" && data.status.includes("terminated"))) {
                    outText = data.output || data.status || `Task ${args.task_id || args.id} terminated.`;
                } else if (data.output) {
                    outText = data.output;
                } else if (data.status) {
                    outText = `Status: ${data.status}\n${data.stdout ? `stdout:\n${data.stdout}` : ""}${data.stderr ? `stderr:\n${data.stderr}` : ""}`.trim();
                } else {
                    outText = JSON.stringify(data, null, 2);
                }
            } else if (name === "schedule") {
                outText = `[Schedule Result: ${data.status || "completed"}] Elapsed: ${data.elapsed_seconds ?? args.time ?? args.seconds ?? 0}s${data.exit_code !== undefined ? ` (Exit code: ${data.exit_code})` : ""}`;
                if (data.reason) outText += `\nReason: ${data.reason}`;
                if (data.task_id || args.task) outText += `\nTask: ${data.task_id || args.task}`;
                if (data.end_response) outText += `\nEnd Response: ${data.end_response}`;
                if (data.stdout || data.stderr || data.output) {
                    outText += "\n\n" + (data.stdout || data.output || "") + (data.stderr ? ("\n" + data.stderr) : "");
                }
            } else if (data.stdout || data.stderr) {
                outText = (data.stdout || "") + (data.stderr ? ("\n" + data.stderr) : "");
            } else if (name === "web_search") {
                if (data.results && Array.isArray(data.results)) {
                    outText = data.results.map(r => `[${r.title || r.url}]\n${(r.snippet || r.text || r.content || "").slice(0, 800)}${(r.snippet || r.text || r.content || "").length > 800 ? "..." : ""}`).join("\n\n---\n\n");
                } else if (data.markdown || data.content) {
                    outText = data.markdown || data.content;
                } else {
                    outText = JSON.stringify(data, null, 2);
                }
            } else if (data.results && Array.isArray(data.results)) {
                outText = data.results.map(r => `[${r.title || r.url}]\n${(r.text || "").slice(0, 800)}${r.text?.length > 800 ? "..." : ""}`).join("\n\n---\n\n");
            } else {
                outText = JSON.stringify(data, null, 2);
            }
            resEl.textContent = outText.trim() || "(Executed with no standard output)";
        }
    }
}

/**
 * Marks badge as finished/failed on error.
 */
export function onToolError(name, badgeEl, error = null) {
    if (!badgeEl) return;
    // Always mark as visually complete so the badge never stays in a "Running..." state
    badgeEl.classList.add("timer-finished");
    if (badgeEl._collapseDiv) {
        const resEl = badgeEl._collapseDiv.querySelector(".command-output-res");
        if (resEl) {
            const errStr = error && error.message ? error.message : (error ? String(error) : "Execution failed");
            resEl.textContent = `Error: ${errStr}`;
            resEl.style.color = "#f87171";
        }
    }
}
