/**
 * MultiAI Cloud Client Tools
 * ===========================
 * Handles UI interactions for:
 * 1. Uploading files to /tmp/user/files
 * 2. Remote git repository branch inspection and one-click cloning
 */

export function initCloudTools() {
    setupUploadUI();
    setupGitCloneUI();
    setupWorkdirSelector();
}

export async function setupWorkdirSelector() {
    const btn = document.getElementById("heroWorkdirPickerBtn");
    const label = document.getElementById("heroWorkdirLabel");
    const dropdown = document.getElementById("heroWorkdirDropdown");

    if (!btn || !dropdown) return;

    let cachedWorkspaces = null;

    async function fetchWorkspaces() {
        try {
            const res = await fetch("/api/cloud/workspaces");
            const data = await res.json();
            if (data.success) {
                cachedWorkspaces = data;
                renderWorkspacesDropdown();
            }
        } catch (_) {}
    }

    function renderWorkspacesDropdown() {
        if (!cachedWorkspaces) return;
        const currentPath = cachedWorkspaces.current || "/tmp/workspace";
        const isDefaultActive = currentPath === cachedWorkspaces.default;

        let html = `
            <div class="workdir-menu-header">WORKSPACE DIRECTORY</div>
            <div class="workdir-item ${isDefaultActive ? 'active' : ''}" data-path="${cachedWorkspaces.default}">
                <i data-lucide="folder" class="workdir-item-icon"></i>
                <div class="workdir-item-text">
                    <span class="workdir-item-name">Default Workspace</span>
                    <span class="workdir-item-path">${cachedWorkspaces.default}</span>
                </div>
                ${isDefaultActive ? '<i data-lucide="check" class="workdir-check"></i>' : ''}
            </div>
        `;

        if (cachedWorkspaces.repos && cachedWorkspaces.repos.length > 0) {
            html += `<div class="workdir-menu-divider">CLONED REPOSITORIES</div>`;
            for (const repo of cachedWorkspaces.repos) {
                const isActive = currentPath === repo.path;
                html += `
                    <div class="workdir-item ${isActive ? 'active' : ''}" data-path="${repo.path}">
                        <i data-lucide="git-branch" class="workdir-item-icon"></i>
                        <div class="workdir-item-text">
                            <span class="workdir-item-name">${repo.name}</span>
                            <span class="workdir-item-path">${repo.path}</span>
                        </div>
                        ${isActive ? '<i data-lucide="check" class="workdir-check"></i>' : ''}
                    </div>
                `;
            }
        } else {
            html += `<div class="workdir-empty">No cloned repositories yet. Clone a repository to add it here.</div>`;
        }

        dropdown.innerHTML = html;
        if (window.lucide) window.lucide.createIcons();

        // Update button label
        if (label) {
            if (isDefaultActive) {
                label.textContent = "Workspace: Default";
            } else {
                const matched = cachedWorkspaces.repos.find(r => r.path === currentPath);
                label.textContent = `Workspace: ${matched ? matched.name : currentPath.split("/").pop()}`;
            }
        }

        // Attach click handlers
        dropdown.querySelectorAll(".workdir-item").forEach(item => {
            item.addEventListener("click", async () => {
                const targetPath = item.getAttribute("data-path");
                dropdown.style.display = "none";
                try {
                    await fetch("/api/cloud/workspaces/select", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ path: targetPath })
                    });
                    await fetchWorkspaces();
                } catch (_) {}
            });
        });
    }

    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = dropdown.style.display === "block";
        if (isOpen) {
            dropdown.style.display = "none";
        } else {
            const rect = btn.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            if (spaceBelow < 220 && rect.top > 220) {
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

    // Initial load
    fetchWorkspaces();
}

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

    // Drop area click triggers file input
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
        uploadStatus.textContent = `Uploading ${files.length} file(s) to /tmp/user/files...`;
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
        fileListContainer.innerHTML = `<div class="cloud-loading">Loading /tmp/user/files...</div>`;
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

function setupGitCloneUI() {
    const cloneBtn = document.getElementById("cloudGitCloneBtn");
    const modal = document.getElementById("cloudGitCloneModal");
    const backdrop = document.getElementById("cloudGitCloneBackdrop");
    const closeBtn = document.getElementById("cloudGitCloseBtn");

    const repoUrlInput = document.getElementById("cloudGitRepoUrl");
    const inspectBtn = document.getElementById("cloudGitInspectBtn");
    const branchSelect = document.getElementById("cloudGitBranchSelect");
    const branchSection = document.getElementById("cloudGitBranchSection");
    const cloneConfirmBtn = document.getElementById("cloudGitDoCloneBtn");
    const cloneAllCheckbox = document.getElementById("cloudGitCloneAll");
    const gitStatus = document.getElementById("cloudGitStatus");

    if (!cloneBtn) return;

    function openModal() {
        if (modal) modal.style.display = "block";
        if (backdrop) backdrop.style.display = "block";
        if (window.lucide) window.lucide.createIcons();
    }

    function closeModal() {
        if (modal) modal.style.display = "none";
        if (backdrop) backdrop.style.display = "none";
        if (gitStatus) gitStatus.textContent = "";
    }

    cloneBtn.addEventListener("click", openModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (backdrop) backdrop.addEventListener("click", closeModal);

    // Inspect branches button
    if (inspectBtn && repoUrlInput) {
        inspectBtn.addEventListener("click", async () => {
            const url = repoUrlInput.value.trim();
            if (!url) {
                if (gitStatus) {
                    gitStatus.textContent = "Please enter a Git repository URL.";
                    gitStatus.className = "cloud-status-error";
                }
                return;
            }

            inspectBtn.disabled = true;
            if (gitStatus) {
                gitStatus.textContent = "Fetching remote branches...";
                gitStatus.className = "cloud-status-info";
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
                if (cloneConfirmBtn) cloneConfirmBtn.disabled = false;
                if (gitStatus) {
                    gitStatus.textContent = `Found ${data.branches.length} branch(es). Select branch or check 'Clone All'.`;
                    gitStatus.className = "cloud-status-success";
                }
            } catch (err) {
                inspectBtn.disabled = false;
                if (gitStatus) {
                    gitStatus.textContent = `Error: ${err.message}`;
                    gitStatus.className = "cloud-status-error";
                }
            }
        });
    }

    // Do Clone action
    if (cloneConfirmBtn && repoUrlInput) {
        cloneConfirmBtn.addEventListener("click", async () => {
            const url = repoUrlInput.value.trim();
            const branch = branchSelect ? branchSelect.value : "";
            const cloneAll = cloneAllCheckbox ? cloneAllCheckbox.checked : false;

            cloneConfirmBtn.disabled = true;
            if (gitStatus) {
                gitStatus.textContent = "Cloning repository into /tmp/workspace...";
                gitStatus.className = "cloud-status-info";
            }

            try {
                const res = await fetch("/api/cloud/git/clone", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url, branch, cloneAll })
                });
                const data = await res.json();
                cloneConfirmBtn.disabled = false;

                if (!data.success) {
                    throw new Error(data.error || "Clone failed");
                }

                if (gitStatus) {
                    gitStatus.textContent = `Repository successfully cloned to ${data.targetDir}!`;
                    gitStatus.className = "cloud-status-success";
                }
            } catch (err) {
                cloneConfirmBtn.disabled = false;
                if (gitStatus) {
                    gitStatus.textContent = `Clone error: ${err.message}`;
                    gitStatus.className = "cloud-status-error";
                }
            }
        });
    }
}

