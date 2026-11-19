/**
 * MultiAI Cloud Client Tools & Workspace Synchronization
 * =======================================================
 * Handles UI interactions for:
 * 1. Persistent & Temporary Workspace Switching (Backblaze B2 synced)
 * 2. New Project Creation (Empty or Git Cloned, with Persistent B2 storage)
 * 3. File uploads to /tmp/user/files
 * 4. Automatic Workspace Synchronization (periodic + on disconnect)
 */

let cachedWorkspaces = null;
let activeProjectPath = null;
let activeProjectName = null;
let activeProjectType = "default";

export function initCloudTools() {
    setupUploadUI();
    setupNewProjectUI();
    setupWorkdirSelector();
    setupAutoSyncOnDisconnect();
}

/**
 * Returns current list of known projects (both Backblaze B2 persistent and local temporary)
 */
export function getKnownProjects() {
    const list = [];
    if (cachedWorkspaces) {
        for (const p of cachedWorkspaces.persistent || []) {
            list.push({ name: p.name, path: p.path, type: "persistent" });
        }
        for (const t of cachedWorkspaces.temporary || []) {
            list.push({ name: t.name, path: t.path, type: "temporary" });
        }
    }
    return list;
}

/**
 * Workspace selector dropdown on Start Page and chat navigation
 */
export async function setupWorkdirSelector() {
    const btn = document.getElementById("heroWorkdirPickerBtn");
    const label = document.getElementById("heroWorkdirLabel");
    const dropdown = document.getElementById("heroWorkdirDropdown");

    if (!btn || !dropdown) return;

    async function fetchWorkspaces() {
        try {
            const chatId = (window.state && window.state.currentChatId) || "";
            const res = await fetch("/api/cloud/workspaces", {
                headers: { "x-chat-id": chatId }
            });
            const data = await res.json();
            if (data.success) {
                cachedWorkspaces = data;
                activeProjectPath = data.current || data.default || "/tmp/workspace";

                // Determine active project type and name
                if (activeProjectPath === data.default) {
                    activeProjectName = "Default";
                    activeProjectType = "default";
                } else {
                    const persistentMatch = (data.persistent || []).find(p => p.path === activeProjectPath);
                    if (persistentMatch) {
                        activeProjectName = persistentMatch.name;
                        activeProjectType = "persistent";
                    } else {
                        const tempMatch = (data.temporary || []).find(t => t.path === activeProjectPath);
                        activeProjectName = tempMatch ? tempMatch.name : activeProjectPath.split("/").pop();
                        activeProjectType = "temporary";
                    }
                }

                renderWorkspacesDropdown();
                document.dispatchEvent(new CustomEvent("chatsUpdated"));
            }
        } catch (_) {}
    }

    function renderWorkspacesDropdown() {
        if (!cachedWorkspaces) return;
        const currentPath = activeProjectPath || cachedWorkspaces.current || cachedWorkspaces.default;
        const isDefaultActive = currentPath === cachedWorkspaces.default;

        let html = `
            <div class="workdir-menu-header">DEFAULT WORKSPACE</div>
            <div class="workdir-item ${isDefaultActive ? 'active' : ''}" data-path="${cachedWorkspaces.default}" data-type="default" data-name="Default">
                <i data-lucide="folder" class="workdir-item-icon"></i>
                <div class="workdir-item-text">
                    <span class="workdir-item-name">Default Workspace</span>
                    <span class="workdir-item-path">${cachedWorkspaces.default}</span>
                </div>
                ${isDefaultActive ? '<i data-lucide="check" class="workdir-check"></i>' : ''}
            </div>
        `;

        // 1. Persistent Projects (Backblaze B2)
        const persistentList = cachedWorkspaces.persistent || [];
        html += `<div class="workdir-menu-divider">PERSISTENT PROJECTS (BACKBLAZE B2)</div>`;
        if (persistentList.length > 0) {
            for (const proj of persistentList) {
                const isActive = currentPath === proj.path;
                html += `
                    <div class="workdir-item ${isActive ? 'active' : ''}" data-path="${proj.path}" data-type="persistent" data-name="${proj.name}">
                        <i data-lucide="cloud" class="workdir-item-icon"></i>
                        <div class="workdir-item-text">
                            <span class="workdir-item-name">${proj.name}</span>
                            <span class="workdir-item-path">${proj.path}</span>
                        </div>
                        ${isActive ? '<i data-lucide="check" class="workdir-check"></i>' : ''}
                    </div>
                `;
            }
        } else {
            html += `<div class="workdir-empty">No persistent projects yet. Create one below.</div>`;
        }

        // 2. Temporary Workspaces
        const temporaryList = cachedWorkspaces.temporary || [];
        if (temporaryList.length > 0) {
            html += `<div class="workdir-menu-divider">TEMPORARY WORKSPACES</div>`;
            for (const repo of temporaryList) {
                const isActive = currentPath === repo.path;
                html += `
                    <div class="workdir-item ${isActive ? 'active' : ''}" data-path="${repo.path}" data-type="temporary" data-name="${repo.name}">
                        <i data-lucide="folder-git-2" class="workdir-item-icon"></i>
                        <div class="workdir-item-text">
                            <span class="workdir-item-name">${repo.name}</span>
                            <span class="workdir-item-path">${repo.path}</span>
                        </div>
                        ${isActive ? '<i data-lucide="check" class="workdir-check"></i>' : ''}
                    </div>
                `;
            }
        }

        // 3. New Project Action Item
        html += `
            <div class="workdir-create-action" id="workdirCreateProjectAction">
                <i data-lucide="plus"></i>
                <span>Create New Project…</span>
            </div>
        `;

        dropdown.innerHTML = html;
        if (window.lucide) window.lucide.createIcons();

        // Update button label
        if (label) {
            if (isDefaultActive) {
                label.textContent = "Workspace: Default";
            } else if (activeProjectType === "persistent") {
                label.textContent = `Workspace: ${activeProjectName} (B2)`;
            } else {
                label.textContent = `Workspace: ${activeProjectName}`;
            }
        }

        // Attach workspace selection click handlers
        dropdown.querySelectorAll(".workdir-item").forEach(item => {
            item.addEventListener("click", async () => {
                const targetPath = item.getAttribute("data-path");
                const targetName = item.getAttribute("data-name");
                const targetType = item.getAttribute("data-type");
                dropdown.style.display = "none";

                try {
                    const chatId = (window.state && window.state.currentChatId) || "";
                    await fetch("/api/cloud/workspaces/select", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            path: targetPath,
                            name: targetName,
                            type: targetType,
                            chatId
                        })
                    });
                    activeProjectPath = targetPath;
                    activeProjectName = targetName;
                    activeProjectType = targetType;
                    await fetchWorkspaces();
                    window.dispatchEvent(new CustomEvent("workspaceChanged", {
                        detail: { path: targetPath, name: targetName, type: targetType, chatId }
                    }));
                } catch (_) {}
            });
        });

        // Attach "Create New Project" action handler
        const createAction = dropdown.querySelector("#workdirCreateProjectAction");
        if (createAction) {
            createAction.addEventListener("click", () => {
                dropdown.style.display = "none";
                openProjectModal();
            });
        }
    }

    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = dropdown.style.display === "block";
        if (isOpen) {
            dropdown.style.display = "none";
        } else {
            const rect = btn.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            if (spaceBelow < 260 && rect.top > 260) {
                dropdown.style.top = "auto";
                dropdown.style.bottom = "calc(100% + 8px)";
            } else {
                dropdown.style.top = "calc(100% + 8px)";
                dropdown.style.bottom = "auto";
            }
            dropdown.style.display = "block";
            fetchWorkspaces();
        }
    });

    document.addEventListener("click", (e) => {
        if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
            dropdown.style.display = "none";
        }
    });

    // Listen for workspace change events from other parts of the application
    window.addEventListener("refreshWorkspaces", () => {
        fetchWorkspaces();
    });

    // Initial load
    fetchWorkspaces();
}

/**
 * Modal opener helper for New Project
 */
function openProjectModal() {
    const modal = document.getElementById("cloudGitCloneModal");
    const backdrop = document.getElementById("cloudGitCloneBackdrop");
    const nameInput = document.getElementById("cloudProjectName");
    const statusMsg = document.getElementById("cloudGitStatus");

    if (modal) modal.style.display = "block";
    if (backdrop) backdrop.style.display = "block";
    if (statusMsg) statusMsg.textContent = "";
    if (nameInput) {
        nameInput.value = "";
        nameInput.focus();
    }
    if (window.lucide) window.lucide.createIcons();
}

function closeProjectModal() {
    const modal = document.getElementById("cloudGitCloneModal");
    const backdrop = document.getElementById("cloudGitCloneBackdrop");
    const statusMsg = document.getElementById("cloudGitStatus");

    if (modal) modal.style.display = "none";
    if (backdrop) backdrop.style.display = "none";
    if (statusMsg) statusMsg.textContent = "";
}

/**
 * Setup New Project creation UI with Persistent B2 storage and Git clone option
 */
function setupNewProjectUI() {
    const newProjectBtn = document.getElementById("cloudNewProjectBtn");
    const gitCloneLegacyBtn = document.getElementById("cloudGitCloneBtn");
    const backdrop = document.getElementById("cloudGitCloneBackdrop");
    const closeBtn = document.getElementById("cloudGitCloseBtn");
    const cancelBtn = document.getElementById("cloudProjectCancelBtn");

    const nameInput = document.getElementById("cloudProjectName");
    const pathHint = document.getElementById("cloudProjectPathHint");
    const persistentCard = document.getElementById("cloudStoragePersistentCard");
    const temporaryCard = document.getElementById("cloudStorageTemporaryCard");
    const emptySourceBtn = document.getElementById("cloudSourceEmptyBtn");
    const gitSourceBtn = document.getElementById("cloudSourceGitBtn");
    const gitCloneSection = document.getElementById("cloudGitCloneSection");

    const repoUrlInput = document.getElementById("cloudGitRepoUrl");
    const inspectBtn = document.getElementById("cloudGitInspectBtn");
    const branchSelect = document.getElementById("cloudGitBranchSelect");
    const branchSection = document.getElementById("cloudGitBranchSection");
    const cloneAllCheckbox = document.getElementById("cloudGitCloneAll");
    const createProjectBtn = document.getElementById("cloudGitDoCloneBtn");
    const statusMsg = document.getElementById("cloudGitStatus");

    let selectedType = "persistent";
    let selectedSource = "empty";

    if (newProjectBtn) newProjectBtn.addEventListener("click", openProjectModal);
    if (gitCloneLegacyBtn) gitCloneLegacyBtn.addEventListener("click", openProjectModal);
    if (closeBtn) closeBtn.addEventListener("click", closeProjectModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeProjectModal);
    if (backdrop) backdrop.addEventListener("click", closeProjectModal);

    // Live path hint as user types project name
    if (nameInput && pathHint) {
        nameInput.addEventListener("input", () => {
            const val = nameInput.value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_");
            pathHint.textContent = val ? `/tmp/workspace/${val}` : "/tmp/workspace/<name>";
        });
    }

    // Storage persistence toggle
    if (persistentCard && temporaryCard) {
        persistentCard.addEventListener("click", () => {
            selectedType = "persistent";
            persistentCard.classList.add("active");
            temporaryCard.classList.remove("active");
        });

        temporaryCard.addEventListener("click", () => {
            selectedType = "temporary";
            temporaryCard.classList.add("active");
            persistentCard.classList.remove("active");
        });
    }

    // Project source toggle (Empty vs Git)
    if (emptySourceBtn && gitSourceBtn) {
        emptySourceBtn.addEventListener("click", () => {
            selectedSource = "empty";
            emptySourceBtn.classList.add("active");
            gitSourceBtn.classList.remove("active");
            if (gitCloneSection) gitCloneSection.style.display = "none";
        });

        gitSourceBtn.addEventListener("click", () => {
            selectedSource = "git";
            gitSourceBtn.classList.add("active");
            emptySourceBtn.classList.remove("active");
            if (gitCloneSection) gitCloneSection.style.display = "block";
            if (repoUrlInput) repoUrlInput.focus();
        });
    }

    // Inspect git branches
    if (inspectBtn && repoUrlInput) {
        inspectBtn.addEventListener("click", async () => {
            const url = repoUrlInput.value.trim();
            if (!url) {
                if (statusMsg) {
                    statusMsg.textContent = "Please enter a Git repository URL.";
                    statusMsg.className = "cloud-status-error";
                }
                return;
            }

            inspectBtn.disabled = true;
            if (statusMsg) {
                statusMsg.textContent = "Inspecting remote branches…";
                statusMsg.className = "cloud-status-info";
            }

            try {
                const res = await fetch("/api/cloud/git/inspect", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url })
                });
                const data = await res.json();
                inspectBtn.disabled = false;

                if (!data.success) {
                    throw new Error(data.error || "Failed to inspect repository");
                }

                if (branchSelect && branchSection) {
                    branchSelect.innerHTML = data.branches.map(b => `<option value="${b}">${b}</option>`).join("");
                    branchSection.style.display = "block";
                }

                // If project name input is still empty, auto-fill from repo name
                if (nameInput && !nameInput.value.trim()) {
                    const inferredName = url.split("/").pop().replace(/\.git$/, "");
                    nameInput.value = inferredName;
                    if (pathHint) pathHint.textContent = `/tmp/workspace/${inferredName}`;
                }

                if (statusMsg) {
                    statusMsg.textContent = `Found ${data.branches.length} branch(es). Ready to clone.`;
                    statusMsg.className = "cloud-status-success";
                }
            } catch (err) {
                inspectBtn.disabled = false;
                if (statusMsg) {
                    statusMsg.textContent = `Error: ${err.message}`;
                    statusMsg.className = "cloud-status-error";
                }
            }
        });
    }

    // Create Project Action
    if (createProjectBtn) {
        createProjectBtn.addEventListener("click", async () => {
            const name = nameInput ? nameInput.value.trim() : "";
            if (!name) {
                if (statusMsg) {
                    statusMsg.textContent = "Please enter a project name.";
                    statusMsg.className = "cloud-status-error";
                }
                if (nameInput) nameInput.focus();
                return;
            }

            const gitUrl = repoUrlInput ? repoUrlInput.value.trim() : "";
            const gitBranch = branchSelect ? branchSelect.value : "";
            const cloneAll = cloneAllCheckbox ? cloneAllCheckbox.checked : false;

            if (selectedSource === "git" && !gitUrl) {
                if (statusMsg) {
                    statusMsg.textContent = "Please enter a repository URL or switch to Empty Project.";
                    statusMsg.className = "cloud-status-error";
                }
                return;
            }

            createProjectBtn.disabled = true;
            if (statusMsg) {
                statusMsg.textContent = selectedType === "persistent"
                    ? "Creating project and syncing initial snapshot to Backblaze B2…"
                    : "Creating project workspace…";
                statusMsg.className = "cloud-status-info";
            }

            try {
                const chatId = (window.state && window.state.currentChatId) || "";
                const res = await fetch("/api/cloud/projects/create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name,
                        type: selectedType,
                        source: selectedSource,
                        gitUrl,
                        gitBranch,
                        cloneAll,
                        chatId
                    })
                });

                const data = await res.json();
                createProjectBtn.disabled = false;

                if (!data.success) {
                    throw new Error(data.error || "Project creation failed");
                }

                if (statusMsg) {
                    statusMsg.textContent = selectedType === "persistent"
                        ? `Project "${data.project.name}" created and synced to Backblaze B2!`
                        : `Project "${data.project.name}" created!`;
                    statusMsg.className = "cloud-status-success";
                }

                activeProjectPath = data.workdir;
                activeProjectName = data.project.name;
                activeProjectType = data.project.type;

                // Close modal and refresh workspaces
                setTimeout(() => {
                    closeProjectModal();
                    window.dispatchEvent(new CustomEvent("refreshWorkspaces"));
                    window.dispatchEvent(new CustomEvent("workspaceChanged", {
                        detail: {
                            path: data.workdir,
                            name: data.project.name,
                            type: data.project.type,
                            chatId
                        }
                    }));
                }, 800);
            } catch (err) {
                createProjectBtn.disabled = false;
                if (statusMsg) {
                    statusMsg.textContent = `Creation failed: ${err.message}`;
                    statusMsg.className = "cloud-status-error";
                }
            }
        });
    }
}

/**
 * Setup automatic synchronization on disconnect or unload
 */
function setupAutoSyncOnDisconnect() {
    function triggerDisconnectSync() {
        if (activeProjectType === "persistent" && activeProjectName) {
            const payload = JSON.stringify({
                name: activeProjectName,
                workdir: activeProjectPath
            });

            if (navigator.sendBeacon) {
                const blob = new Blob([payload], { type: "application/json" });
                navigator.sendBeacon("/api/cloud/projects/sync", blob);
            } else {
                fetch("/api/cloud/projects/sync", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: payload,
                    keepalive: true
                }).catch(() => {});
            }
        }
    }

    // Trigger on tab close, navigate away, or reload
    window.addEventListener("beforeunload", triggerDisconnectSync);

    // Also trigger when tab is backgrounded
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            triggerDisconnectSync();
        }
    });
}

/**
 * File upload handlers to /tmp/user/files
 */
function setupUploadUI() {
    const uploadBtn = document.getElementById("cloudUploadBtn");
    const modal = document.getElementById("cloudUploadModal");
    const backdrop = document.getElementById("cloudUploadBackdrop");
    const closeBtn = document.getElementById("cloudUploadCloseBtn");
    const fileInput = document.getElementById("cloudFileInput");
    const dropArea = document.getElementById("cloudFileDropArea");
    const fileListContainer = document.getElementById("cloudUploadedFilesList");
    const uploadStatus = document.getElementById("cloudUploadStatus");

    if (!uploadBtn) return;

    function openModal() {
        if (modal) modal.style.display = "block";
        if (backdrop) backdrop.style.display = "block";
        loadUploadedFiles();
        if (window.lucide) window.lucide.createIcons();
    }

    function closeModal() {
        if (modal) modal.style.display = "none";
        if (backdrop) backdrop.style.display = "none";
        if (uploadStatus) uploadStatus.textContent = "";
    }

    uploadBtn.addEventListener("click", openModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (backdrop) backdrop.addEventListener("click", closeModal);

    if (dropArea && fileInput) {
        dropArea.addEventListener("click", () => fileInput.click());

        dropArea.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropArea.classList.add("dragover");
        });

        dropArea.addEventListener("dragleave", () => {
            dropArea.classList.remove("dragover");
        });

        dropArea.addEventListener("drop", (e) => {
            e.preventDefault();
            dropArea.classList.remove("dragover");
            if (e.dataTransfer?.files?.length) {
                handleFiles(e.dataTransfer.files);
            }
        });

        fileInput.addEventListener("change", (e) => {
            if (e.target.files?.length) {
                handleFiles(e.target.files);
            }
        });
    }

    async function handleFiles(files) {
        if (!uploadStatus) return;
        uploadStatus.textContent = `Uploading ${files.length} file(s) to /tmp/user/files…`;
        uploadStatus.className = "cloud-status-info";

        for (const file of files) {
            try {
                const reader = new FileReader();
                const base64Promise = new Promise((resolve, reject) => {
                    reader.onload = () => {
                        const res = reader.result;
                        const commaIdx = res.indexOf(",");
                        resolve(commaIdx !== -1 ? res.slice(commaIdx + 1) : res);
                    };
                    reader.onerror = reject;
                });
                reader.readAsDataURL(file);
                const contentBase64 = await base64Promise;

                const res = await fetch("/api/cloud/upload", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        filename: file.name,
                        contentBase64
                    })
                });

                const data = await res.json();
                if (!data.success) {
                    throw new Error(data.error || "Upload failed");
                }
            } catch (err) {
                uploadStatus.textContent = `Error uploading ${file.name}: ${err.message}`;
                uploadStatus.className = "cloud-status-error";
                return;
            }
        }

        uploadStatus.textContent = "All files uploaded to /tmp/user/files successfully!";
        uploadStatus.className = "cloud-status-success";
        loadUploadedFiles();
    }

    async function loadUploadedFiles() {
        if (!fileListContainer) return;
        fileListContainer.innerHTML = `<div class="cloud-loading">Loading /tmp/user/files…</div>`;
        try {
            const res = await fetch("/api/cloud/uploads");
            const data = await res.json();
            if (data.success && data.files?.length > 0) {
                fileListContainer.innerHTML = data.files.map(f => `
                    <div class="cloud-file-item">
                        <div class="cloud-file-info">
                            <i data-lucide="file" class="cloud-file-icon"></i>
                            <span class="cloud-file-name" title="${f.path}">${f.name}</span>
                        </div>
                        <span class="cloud-file-size">${(f.size / 1024).toFixed(1)} KB</span>
                    </div>
                `).join("");
                if (window.lucide) window.lucide.createIcons();
            } else {
                fileListContainer.innerHTML = `<div class="cloud-empty-files">No files in /tmp/user/files yet</div>`;
            }
        } catch (e) {
            fileListContainer.innerHTML = `<div class="cloud-empty-files">Could not list files</div>`;
        }
    }
}
