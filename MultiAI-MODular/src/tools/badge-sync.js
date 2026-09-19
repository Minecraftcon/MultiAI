/**
 * Badge Synchronization & UI Presentation for Tool Executions
 */

/**
 * Initializes visual timers and indicators on tool badge start.
 */
export function onToolStart(name, args, badgeEl) {
    if (!badgeEl) return;

    if (name === "run_task") {
        const cooldown = Math.max(1, parseInt(args.timeout, 10) || 1);
        const ringBar = badgeEl.querySelector(".timer-ring-bar");
        if (ringBar) {
            ringBar.style.transition = "none";
            ringBar.style.strokeDashoffset = "108.39";
            void ringBar.getBoundingClientRect();
            ringBar.style.transition = `stroke-dashoffset ${cooldown}s linear`;
            ringBar.style.strokeDashoffset = "0";
        }
    }

    if (name === "idle") {
        const cooldown = Math.max(1, parseInt(args.seconds, 10) || 5);
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

    if (name === "run_task" || name === "idle") {
        const ringBar = badgeEl.querySelector(".timer-ring-bar");
        if (ringBar) {
            ringBar.style.transition = "stroke-dashoffset 0.15s ease, stroke 0.3s ease";
            ringBar.style.strokeDashoffset = "0";
        }
        badgeEl.classList.add("timer-finished");

        if (name === "idle" && data) {
            const labelEl = badgeEl.querySelector(".search-label");
            const queryEl = badgeEl.querySelector(".search-query");
            if (data.status === "task_completed") {
                if (labelEl) labelEl.textContent = "Task completed";
                if (queryEl) queryEl.textContent = `${data.task_id || "task"} exited in ${data.elapsed_seconds}s (code: ${data.exit_code ?? 0})`;
            } else if (data.status === "task_output") {
                if (labelEl) labelEl.textContent = "Task output";
                if (queryEl) queryEl.textContent = `${data.task_id || "task"} emitted output in ${data.elapsed_seconds}s`;
            } else {
                if (labelEl) labelEl.textContent = "Timer hit";
                if (queryEl) queryEl.textContent = `${data.elapsed_seconds || args.seconds || 5}s cooldown completed`;
            }
        }
    }

    // Format output in collapse div if present
    if (badgeEl._collapseDiv && data) {
        const resEl = badgeEl._collapseDiv.querySelector(".command-output-res");
        if (resEl) {
            let outText = "";
            const isLarge = data.is_large_output || (data.stdout && data.stdout.split("\n").length > 100);
            if (isLarge && (name === "run_task" || name === "idle" || name.startsWith("task_"))) {
                const rawOutput = data.truncated_lines || data.stdout || "";
                const lines = rawOutput.split("\n").slice(-100);
                const indentedLines = lines.map(l => "      " + l).join("\n");
                outText = `id: ${data.task_id || args.task_id || "task"}\n`;
                if (data.stderr && data.stderr.trim()) {
                    outText += `stderr: [output truncated] ... showing last 100 lines\n${indentedLines}\n`;
                } else {
                    outText += `stdout: [output truncated] ... showing last 100 lines\n${indentedLines}\n`;
                }
                outText += `status_code: ${data.exit_code ?? 0}\n`;
                outText += `ran_for: ${data.ran_for || data.elapsed_seconds || "1.0"}s\n`;
                outText += `sys: output has been saved to ${data.scratch_log_path || `scratch/${args.task_name ? (args.task_name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') + '-') : ''}${data.task_id || 'task'}.log`}`;
            } else if (name === "read_file") {
                if (data.action === "view" && data.type === "image") {
                    outText = `[Image View: ${data.path} (${data.mime}, ${data.human_size})]\n${data.markdown || ""}`;
                } else if (data.action === "info") {
                    outText = JSON.stringify(data, null, 2);
                } else {
                    outText = data.content || (data.entries ? JSON.stringify(data.entries, null, 2) : "");
                }
            } else if (name === "write_file" || name === "search_and_replace") {
                outText = data.message || JSON.stringify(data, null, 2);
                if (data.syntax_warning) {
                    outText += `\n\n[Warning]: ${data.syntax_warning}`;
                }
            } else if (name === "grep_search") {
                if (data.matches && Array.isArray(data.matches)) {
                    outText = `Found ${data.total_matches ?? data.matches.length} match(es) (${data.engine_used || "scan"}, ${data.elapsed_ms || 0}ms):\n` +
                        data.matches.map(m => `${m.file}:${m.line_number}: ${m.line_content}`).join("\n");
                } else if (data.files && Array.isArray(data.files)) {
                    outText = `Found ${data.total_files ?? data.files.length} file(s) (${data.engine_used || "scan"}, ${data.elapsed_ms || 0}ms):\n` +
                        data.files.join("\n");
                } else {
                    outText = JSON.stringify(data, null, 2);
                }
            } else if (name === "generate_image") {
                outText = `[Image Generated: ${data.model || "flux"} (${data.dimensions?.width || 1024}x${data.dimensions?.height || 1024})]\n${data.markdown || `![](${data.url})`}\nDirect URL: ${data.url}`;
                if (data.url) {
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
                    imgPreview.src = data.url;
                    imgPreview.alt = data.prompt || "Generated image";
                }
            } else if (name === "task_send_input") {
                outText = data.output || `input: (${data.input || (args.type === "keycode" || args.combination ? (args.combination || "key") : (args.field !== undefined ? args.field : (args.input_string || "")))}), sent successfully\nStatus: ${data.status || (data.running ? "running" : "finished")}\nstderr: ${data.stderr || ""}${data.stdout ? `\nstdout: ${data.stdout}` : ""}`;
            } else if (name === "idle") {
                outText = `[Idle Result: ${data.status}] Elapsed: ${data.elapsed_seconds}s${data.exit_code !== undefined ? ` (Exit code: ${data.exit_code})` : ""}`;
                if (data.stdout || data.stderr) {
                    outText += "\n\n" + (data.stdout || "") + (data.stderr ? ("\n" + data.stderr) : "");
                }
            } else if (data.stdout || data.stderr) {
                outText = (data.stdout || "") + (data.stderr ? ("\n" + data.stderr) : "");
            } else if (data.status) {
                outText = data.status;
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
export function onToolError(name, badgeEl) {
    if (!badgeEl) return;
    if (name === "run_task" || name === "idle") {
        badgeEl.classList.add("timer-finished");
    }
}
