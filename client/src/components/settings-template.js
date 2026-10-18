/* =========================================================
   SETTINGS SCREEN HTML TEMPLATE & MOUNT HELPER
   Modular extraction of Settings Screen DOM tree
   ========================================================= */

export function getSettingsHTML() {
    return `    <div id="settingsScreen" class="settings-screen" aria-hidden="true">
        <!-- Settings Header -->
        <div class="settings-header">
            <div class="settings-header-left">
                <button id="settingsBackBtn" type="button" class="settings-back-btn" title="Return to chat" aria-label="Back to Chat">
                    <i data-lucide="arrow-left"></i>
                    <span>Back to Chat</span>
                </button>
                <div class="settings-header-title-group">
                    <h1 class="settings-header-title">Settings</h1>
                    <span id="settingsActiveBadge" class="settings-header-badge">GENERAL</span>
                </div>
            </div>
            <div class="settings-header-right">
                <div id="settingsSaveStatus" class="settings-save-status">
                    <i data-lucide="check"></i>
                    <span>Auto-saved</span>
                </div>
            </div>
        </div>

        <!-- Settings Layout: Sidebar + Sub-screens -->
        <div class="settings-layout">
            <!-- Left Sidebar Navigation -->
            <nav class="settings-sidebar" aria-label="Settings Categories">
                <button type="button" class="settings-nav-item active" data-subscreen="general" aria-selected="true">
                    <i data-lucide="sliders-horizontal"></i>
                    <span>General</span>
                </button>
                <button type="button" class="settings-nav-item" data-subscreen="models" aria-selected="false">
                    <i data-lucide="bot"></i>
                    <span>Models & AI</span>
                </button>
                <button type="button" class="settings-nav-item" data-subscreen="images" aria-selected="false">
                    <i data-lucide="image"></i>
                    <span>Image Generation</span>
                </button>
                <button type="button" class="settings-nav-item" data-subscreen="tools" aria-selected="false">
                    <i data-lucide="wrench"></i>
                    <span>Agent & Tools</span>
                </button>
                <button type="button" class="settings-nav-item" data-subscreen="appearance" aria-selected="false">
                    <i data-lucide="palette"></i>
                    <span>Appearance</span>
                </button>
                <button type="button" class="settings-nav-item" data-subscreen="storage" aria-selected="false">
                    <i data-lucide="database"></i>
                    <span>Data & Storage</span>
                </button>
                <button type="button" class="settings-nav-item" data-subscreen="about" aria-selected="false">
                    <i data-lucide="info"></i>
                    <span>About & Status</span>
                </button>
            </nav>

            <!-- Right Content Panels -->
            <main class="settings-content">
                <!-- 1. GENERAL -->
                <section id="subScreen_general" class="settings-subscreen active">
                    <div class="settings-subscreen-header">
                        <h2 class="settings-subscreen-title">General Preferences</h2>
                        <p class="settings-subscreen-desc">Manage startup behavior, system instructions, and input controls.</p>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">Startup & Defaults</span>
                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Default Startup Model</span>
                                <span class="settings-item-desc">Selected automatically when opening or starting new chats</span>
                            </div>
                            <select id="cfgStartupLLM" class="settings-select"></select>
                        </div>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">System Instructions</span>
                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Persona Preset</span>
                                <span class="settings-item-desc">Defines the baseline personality and focus of the AI</span>
                            </div>
                            <select id="cfgSystemPreset" class="settings-select">
                                <option value="default">General Assistant (Balanced)</option>
                                <option value="developer">Senior Software Engineer (Deep Code)</option>
                                <option value="creative">Creative Thinker & Writer</option>
                                <option value="concise">Direct & Concise (Zero Fluff)</option>
                                <option value="custom">Custom Instructions...</option>
                            </select>
                        </div>
                        <div id="cfgCustomPromptRow" class="settings-row-stacked" style="display: none;">
                            <label for="cfgCustomSystemPrompt" class="settings-item-title">Custom Instructions</label>
                            <textarea id="cfgCustomSystemPrompt" class="settings-textarea" placeholder="Enter custom system instructions for all conversations..."></textarea>
                        </div>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">Composer Keys</span>
                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Send Key Behavior</span>
                                <span class="settings-item-desc">Control keyboard shortcut to submit messages</span>
                            </div>
                            <select id="cfgSendKey" class="settings-select">
                                <option value="enter">Enter to Send (Shift+Enter for newline)</option>
                                <option value="cmd_enter">Cmd/Ctrl+Enter to Send (Enter for newline)</option>
                            </select>
                        </div>
                    </div>
                </section>

                <!-- 2. MODELS & AI -->
                <section id="subScreen_models" class="settings-subscreen">
                    <div class="settings-subscreen-header">
                        <h2 class="settings-subscreen-title">Models & AI Generation</h2>
                        <p class="settings-subscreen-desc">Tune model parameters, reasoning visibility, and turn execution limits.</p>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">Inference Tuning</span>
                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Creativity & Temperature</span>
                                <span class="settings-item-desc">Higher values produce more creative output; lower values are more precise</span>
                            </div>
                            <div class="settings-range-container">
                                <input type="range" id="cfgTemperature" class="settings-range" min="0.0" max="1.0" step="0.05" value="0.7">
                                <span id="cfgTemperatureVal" class="settings-range-val">0.70</span>
                            </div>
                        </div>

                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Stream Reasoning & Thinking</span>
                                <span class="settings-item-desc">Display real-time thinking process and thoughts collapsible card</span>
                            </div>
                            <label class="settings-switch">
                                <input type="checkbox" id="cfgStreamReasoning">
                                <span class="settings-slider"></span>
                            </label>
                        </div>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">Limits & Safeguards</span>
                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Turn Timeout</span>
                                <span class="settings-item-desc">Maximum seconds before aborting stalled generations</span>
                            </div>
                            <select id="cfgTurnTimeout" class="settings-select">
                                <option value="60">60 seconds (1 min)</option>
                                <option value="120">120 seconds (2 mins - Recommended)</option>
                                <option value="300">300 seconds (5 mins)</option>
                            </select>
                        </div>

                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Context History Messages</span>
                                <span class="settings-item-desc">Max past turns sent to the LLM per prompt</span>
                            </div>
                            <select id="cfgMaxHistory" class="settings-select">
                                <option value="20">20 messages</option>
                                <option value="50">50 messages</option>
                                <option value="100">100 messages (Default)</option>
                            </select>
                        </div>
                    </div>
                </section>

                <!-- 3. IMAGE GENERATION -->
                <section id="subScreen_images" class="settings-subscreen">
                    <div class="settings-subscreen-header">
                        <h2 class="settings-subscreen-title">Image Generation</h2>
                        <p class="settings-subscreen-desc">Configure default models, providers, and proportions for visual creation.</p>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">Image Engine</span>
                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Default Image Provider</span>
                                <span class="settings-item-desc">Backend service used to generate art and illustrations</span>
                            </div>
                            <select id="cfgImageProvider" class="settings-select">
                                <option value="pollinations">Pollinations.AI (Free, Unlimited, No Key)</option>
                                <option value="openai_image">OpenAI DALL-E (API Key)</option>
                                <option value="logflare">Logflare Custom</option>
                            </select>
                        </div>

                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Default Aspect Ratio</span>
                                <span class="settings-item-desc">Initial canvas proportion for generated images</span>
                            </div>
                            <select id="cfgImageRatio" class="settings-select">
                                <option value="1:1">1:1 Square (1024x1024)</option>
                                <option value="16:9">16:9 Landscape (Desktop & Cinematic)</option>
                                <option value="9:16">9:16 Portrait (Mobile & Wallpapers)</option>
                                <option value="4:3">4:3 Standard</option>
                                <option value="3:2">3:2 Classic Photo</option>
                            </select>
                        </div>

                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Default Image Model</span>
                                <span class="settings-item-desc">Base diffusion checkpoint</span>
                            </div>
                            <select id="cfgImageModel" class="settings-select">
                                <option value="flux">Flux (State of the art quality)</option>
                                <option value="turbo">Turbo (Ultra fast generation)</option>
                            </select>
                        </div>
                    </div>
                </section>

                <!-- 4. AGENT & TOOLS -->
                <section id="subScreen_tools" class="settings-subscreen">
                    <div class="settings-subscreen-header">
                        <h2 class="settings-subscreen-title">Agent Capabilities & Tools</h2>
                        <p class="settings-subscreen-desc">Toggle tools available for autonomous multi-step tool execution.</p>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">Tool Toggles</span>
                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Web Search</span>
                                <span class="settings-item-desc">Allows the model to fetch real-time facts and documentation online</span>
                            </div>
                            <label class="settings-switch">
                                <input type="checkbox" id="cfgEnableWebSearch" checked>
                                <span class="settings-slider"></span>
                            </label>
                        </div>

                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Terminal & Shell</span>
                                <span class="settings-item-desc">Allows the model to propose and execute shell commands</span>
                            </div>
                            <label class="settings-switch">
                                <input type="checkbox" id="cfgEnableTerminal" checked>
                                <span class="settings-slider"></span>
                            </label>
                        </div>

                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">File System Operations</span>
                                <span class="settings-item-desc">Allows reading, viewing, and writing project files</span>
                            </div>
                            <label class="settings-switch">
                                <input type="checkbox" id="cfgEnableFileOperations" checked>
                                <span class="settings-slider"></span>
                            </label>
                        </div>

                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Autonomous Image Generation</span>
                                <span class="settings-item-desc">Allows the model to trigger image creation tools autonomously</span>
                            </div>
                            <label class="settings-switch">
                                <input type="checkbox" id="cfgEnableImageGeneration" checked>
                                <span class="settings-slider"></span>
                            </label>
                        </div>

                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Model Context Protocol (MCP)</span>
                                <span class="settings-item-desc">Enable external tool integration servers using Anthropic MCP specification</span>
                            </div>
                            <label class="settings-switch">
                                <input type="checkbox" id="cfgEnableMcp" checked>
                                <span class="settings-slider"></span>
                            </label>
                        </div>
                    </div>

                    <!-- SANDBOX & ISOLATION -->
                    <div class="settings-card" id="cfgSandboxCard">
                        <div class="settings-row" style="padding: 0 0 10px 0; border-bottom: 1px solid var(--border);">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Sandbox Environment</span>
                                <span class="settings-item-desc">Confines bash command execution to an isolated container. When disabled, tasks run directly on the host.</span>
                            </div>
                            <label class="settings-switch">
                                <input type="checkbox" id="cfgEnableSandbox">
                                <span class="settings-slider"></span>
                            </label>
                        </div>

                        <!-- Dynamic Sandbox Profiles Grid -->
                        <div id="sandboxProfilesGrid" class="sandbox-profiles-grid">
                            <div class="sandbox-loading-state">Loading environments…</div>
                        </div>

                        <div id="sandboxStatusLine" class="sandbox-status-line">
                            <span id="sandboxStatusText">Active: Bubblewrap</span>
                        </div>
                    </div>

                    <!-- MCP TOOL SERVERS CARD -->
                    <div class="settings-card" id="cfgMcpCard">
                        <div class="settings-card-header-row">
                            <div class="settings-card-header-info">
                                <span class="settings-card-title">Model Context Protocol Servers</span>
                                <span class="settings-item-desc">Connect external MCP servers (stdio subprocesses or SSE endpoints) to expand agent tool capabilities</span>
                            </div>
                            <div class="mcp-card-actions">
                                <button type="button" id="btnRefreshMcpServers" class="settings-action-btn secondary btn-sm" title="Refresh servers and discovered tools">
                                    <i data-lucide="refresh-cw"></i>
                                    <span>Sync</span>
                                </button>
                                <button type="button" id="btnToggleAddMcpServer" class="settings-action-btn secondary btn-sm">
                                    <i data-lucide="plus"></i>
                                    <span>Add Server</span>
                                </button>
                            </div>
                        </div>

                        <!-- Add Server Form (Expandable) -->
                        <div id="mcpAddServerContainer" class="mcp-add-server-form" style="display: none;">
                            <div class="mcp-form-header">
                                <span class="mcp-form-title">Configure New MCP Server</span>
                            </div>
                            <div class="mcp-form-grid">
                                <div class="mcp-form-field">
                                    <label for="mcpNewServerId">Server Identifier</label>
                                    <input type="text" id="mcpNewServerId" class="settings-input" placeholder="e.g. filesystem, github, postgres" autocomplete="off">
                                </div>
                                <div class="mcp-form-field">
                                    <label for="mcpNewTransport">Transport</label>
                                    <select id="mcpNewTransport" class="settings-select">
                                        <option value="stdio">stdio (Subprocess command)</option>
                                        <option value="sse">sse (Remote Server-Sent Events URL)</option>
                                    </select>
                                </div>
                                <div class="mcp-form-field" id="mcpCommandField">
                                    <label for="mcpNewCommand">Command</label>
                                    <input type="text" id="mcpNewCommand" class="settings-input" placeholder="e.g. npx, python3, uvx" autocomplete="off">
                                </div>
                                <div class="mcp-form-field" id="mcpArgsField">
                                    <label for="mcpNewArgs">Arguments (space-separated)</label>
                                    <input type="text" id="mcpNewArgs" class="settings-input" placeholder="e.g. -y @modelcontextprotocol/server-filesystem /path" autocomplete="off">
                                </div>
                                <div class="mcp-form-field" id="mcpUrlField" style="display: none;">
                                    <label for="mcpNewUrl">SSE URL</label>
                                    <input type="url" id="mcpNewUrl" class="settings-input" placeholder="e.g. http://localhost:8000/sse" autocomplete="off">
                                </div>
                            </div>
                            <div class="mcp-form-actions">
                                <button type="button" id="btnCancelAddMcpServer" class="settings-action-btn secondary btn-sm">
                                    <span>Cancel</span>
                                </button>
                                <button type="button" id="btnSaveMcpServer" class="settings-action-btn btn-sm">
                                    <i data-lucide="check"></i>
                                    <span>Connect Server</span>
                                </button>
                            </div>
                            <div id="mcpAddError" class="mcp-form-error" style="display: none;"></div>
                        </div>

                        <!-- Live Servers List -->
                        <div id="mcpServersList" class="mcp-servers-list">
                            <div class="mcp-loading-state">
                                <span>Loading configured MCP servers...</span>
                            </div>
                        </div>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">Execution Budget</span>
                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Max Tool Iterations</span>
                                <span class="settings-item-desc">Safety ceiling for tool calling loops per message turn</span>
                            </div>
                            <div class="settings-range-container">
                                <input type="range" id="cfgMaxToolRounds" class="settings-range" min="0" max="100" step="5" value="0">
                                <span id="cfgMaxToolRoundsVal" class="settings-range-val">Unlimited</span>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- 5. APPEARANCE -->
                <section id="subScreen_appearance" class="settings-subscreen">
                    <div class="settings-subscreen-header">
                        <h2 class="settings-subscreen-title">Appearance & Interface</h2>
                        <p class="settings-subscreen-desc">Customize theme palette, code presentation, and scroll behavior.</p>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">Theme & Palette</span>
                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Interface Theme</span>
                                <span class="settings-item-desc">Dark obsidian is optimized for low eye strain</span>
                            </div>
                            <select id="cfgTheme" class="settings-select">
                                <option value="dark">Dark (Obsidian)</option>
                                <option value="midnight">Midnight OLED (Deep Black)</option>
                                <option value="light">Light</option>
                                <option value="system">System Default</option>
                            </select>
                        </div>

                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Start Page Aurora Theme</span>
                                <span class="settings-item-desc">Celestial backdrop and aura glow on the welcome screen</span>
                            </div>
                            <select id="cfgAuroraTheme" class="settings-select">
                                <option value="saturn">🪐 Saturn (3D Rings & Nebula)</option>
                                <option value="aurora">🌌 Northern Lights (Boreal Aurora)</option>
                                <option value="clouds" selected>☁️ Lunar Mist (Monochromatic Cloud)</option>
                                <option value="nebula">✨ Cosmic Nebula (Cyan & Magenta)</option>
                                <option value="eclipse">🌑 Solar Eclipse (Amber Corona)</option>
                                <option value="none">🚫 Off (No Glow)</option>
                            </select>
                        </div>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">UI Scaling & Zoom</span>
                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Interface Scale</span>
                                <span class="settings-item-desc">Scale UI size (or use Ctrl + = / Ctrl + -, Ctrl + 0 to reset)</span>
                            </div>
                            <div class="settings-range-container">
                                <input type="range" id="cfgUiScale" class="settings-range" min="60" max="180" step="5" value="100">
                                <span id="cfgUiScaleVal" class="settings-range-val">100%</span>
                                <button id="cfgUiScaleResetBtn" type="button" class="settings-action-btn secondary" style="padding: 4px 10px; font-size: 11.5px; height: 28px;" title="Reset Zoom to 100% (Ctrl+0)">Reset</button>
                            </div>
                        </div>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">Display Options</span>
                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Code Block Line Numbers</span>
                                <span class="settings-item-desc">Show line numbering in generated code blocks</span>
                            </div>
                            <label class="settings-switch">
                                <input type="checkbox" id="cfgShowLineNumbers" checked>
                                <span class="settings-slider"></span>
                            </label>
                        </div>

                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Streaming Auto-Scroll</span>
                                <span class="settings-item-desc">Automatically follow the bottom of the chat as tokens arrive</span>
                            </div>
                            <label class="settings-switch">
                                <input type="checkbox" id="cfgAutoScroll" checked>
                                <span class="settings-slider"></span>
                            </label>
                        </div>

                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Compact Mobile Layout</span>
                                <span class="settings-item-desc">Optimize margins and header sizes on smartphone viewports</span>
                            </div>
                            <label class="settings-switch">
                                <input type="checkbox" id="cfgCompactMobileView" checked>
                                <span class="settings-slider"></span>
                            </label>
                        </div>

                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Limit Mobile Chat Rendering</span>
                                <span class="settings-item-desc">On mobile browsers, render only the latest turns to keep scrolling fast</span>
                            </div>
                            <label class="settings-switch">
                                <input type="checkbox" id="cfgMobileLimitVisibleTurns" checked>
                                <span class="settings-slider"></span>
                            </label>
                        </div>

                        <div class="settings-row" id="cfgMobileVisibleTurnsRow">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Mobile Visible Turns</span>
                                <span class="settings-item-desc">Number of recent turns to render on mobile before "Load earlier"</span>
                            </div>
                            <select id="cfgMobileVisibleTurns" class="settings-select">
                                <option value="10">10 turns</option>
                                <option value="15" selected>15 turns (Recommended)</option>
                                <option value="25">25 turns</option>
                                <option value="50">50 turns</option>
                            </select>
                        </div>
                    </div>
                </section>

                <!-- 6. DATA & STORAGE -->
                <section id="subScreen_storage" class="settings-subscreen">
                    <div class="settings-subscreen-header">
                        <h2 class="settings-subscreen-title">Data & Storage</h2>
                        <p class="settings-subscreen-desc">Manage local conversation storage, export chat archives, and reset cache.</p>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">Persistence Rules</span>
                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Record Chat History</span>
                                <span class="settings-item-desc">Persist conversations in local storage across browser refreshes</span>
                            </div>
                            <label class="settings-switch">
                                <input type="checkbox" id="cfgRecordHistory" checked>
                                <span class="settings-slider"></span>
                            </label>
                        </div>

                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Record Timestamps</span>
                                <span class="settings-item-desc">Store creation and update timestamps for chats</span>
                            </div>
                            <label class="settings-switch">
                                <input type="checkbox" id="cfgRecordDate" checked>
                                <span class="settings-slider"></span>
                            </label>
                        </div>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">Storage Summary</span>
                        <div class="settings-info-grid">
                            <div class="settings-info-box">
                                <span class="settings-info-label">Stored Chats</span>
                                <span id="settingsChatCount" class="settings-info-val">0 conversations</span>
                            </div>
                            <div class="settings-info-box">
                                <span class="settings-info-label">Local Storage</span>
                                <span id="settingsStorageSize" class="settings-info-val">~0 KB</span>
                            </div>
                        </div>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">Data Management</span>
                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Export All Conversations</span>
                                <span class="settings-item-desc">Download full archive of all stored chats in JSON format</span>
                            </div>
                            <button type="button" id="settingsExportAllBtn" class="settings-action-btn secondary">
                                <i data-lucide="download"></i>
                                <span>Export JSON</span>
                            </button>
                        </div>

                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Clear All Chat History</span>
                                <span class="settings-item-desc">Wipes all stored sessions from your local browser database</span>
                            </div>
                            <button type="button" id="settingsClearAllBtn" class="settings-action-btn danger">
                                <i data-lucide="trash-2"></i>
                                <span>Clear History</span>
                            </button>
                        </div>

                        <div class="settings-row">
                            <div class="settings-item-info">
                                <span class="settings-item-title">Reset Settings to Defaults</span>
                                <span class="settings-item-desc">Revert all preferences to initial installation state</span>
                            </div>
                            <button type="button" id="settingsResetDefaultsBtn" class="settings-action-btn secondary">
                                <i data-lucide="rotate-ccw"></i>
                                <span>Reset Defaults</span>
                            </button>
                        </div>
                    </div>
                </section>

                <!-- 7. ABOUT & STATUS -->
                <section id="subScreen_about" class="settings-subscreen">
                    <div class="settings-subscreen-header">
                        <h2 class="settings-subscreen-title">About & Diagnostics</h2>
                        <p class="settings-subscreen-desc">System information, server connectivity, and runtime metrics.</p>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">Application Info</span>
                        <div class="settings-info-grid">
                            <div class="settings-info-box">
                                <span class="settings-info-label">Version</span>
                                <span class="settings-info-val">MultiAI Modular v2.5</span>
                            </div>
                            <div class="settings-info-box">
                                <span class="settings-info-label">Backend Host</span>
                                <span id="aboutServerHost" class="settings-info-val">0.0.0.0</span>
                            </div>
                            <div class="settings-info-box">
                                <span class="settings-info-label">Server Port</span>
                                <span id="aboutServerPort" class="settings-info-val">8080</span>
                            </div>
                            <div class="settings-info-box">
                                <span class="settings-info-label">Configured Models</span>
                                <span id="aboutModelCount" class="settings-info-val">--</span>
                            </div>
                        </div>
                    </div>

                    <div class="settings-card">
                        <span class="settings-card-title">Architecture</span>
                        <div class="settings-item-info">
                            <span class="settings-item-title">Modular Architecture</span>
                            <span class="settings-item-desc">Pure vanilla web standards, decoupled provider layer, native WebFetch streaming, zero vendor-lockin.</span>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    </div>
`;
}

export function mountSettingsScreen(container) {
    const existing = document.getElementById("settingsScreen");
    if (existing) return existing;
    const parent = container || document.getElementById("settingsContainer") || document.getElementById("appShell");
    if (!parent) return null;
    parent.insertAdjacentHTML("beforeend", getSettingsHTML());
    return document.getElementById("settingsScreen");
}
