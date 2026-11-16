/* =========================================================
   DESIGN & VISUAL PREVIEW SUBTOOLS (ISOLATED SUBAGENT TOOLS)
   These tools are subagent-only (subagentOnly: true) and
   do NOT clutter the main agent's prompt context.
   ========================================================= */

/**
 * Live HTML preview tool.
 * Renders HTML/CSS/JS directly inside window.rightPanel's browser iframe.
 */
export const showHtmlPreviewTool = {
    name: "show_html_preview",
    subagentOnly: true,
    schema: {
        type: "function",
        function: {
            name: "show_html_preview",
            description: "Render HTML, CSS, and modern interactive web components live in the browser preview pane. Supports full HTML documents, embedded styles, script tags, layout prototypes, and links.",
            parameters: {
                type: "object",
                properties: {
                    html: {
                        type: "string",
                        description: "The complete HTML markup (including inline style/script if needed) to render live in the preview pane."
                    },
                    title: {
                        type: "string",
                        description: "Tab title for the preview pane (e.g. 'Hero Preview', 'Dashboard UI'). Default is 'HTML Preview'."
                    },
                    path: {
                        type: "string",
                        description: "Optional local file path to load or preview in the browser tab."
                    }
                }
            }
        }
    },
    handler: async (args) => {
        const title = args?.title || "HTML Preview";
        const html = args?.html || "";
        const path = args?.path || "";

        if (typeof window !== "undefined" && window.rightPanel) {
            if (html) {
                if (window.rightPanel.openHtmlPreview) {
                    window.rightPanel.openHtmlPreview(html, title);
                } else if (window.rightPanel.openBrowserTab) {
                    window.rightPanel.openBrowserTab("about:srcdoc");
                    if (window.rightPanel.browserIframe) {
                        window.rightPanel.browserIframe.srcdoc = html;
                    }
                }
            } else if (path) {
                if (window.rightPanel.openBrowserTab) {
                    window.rightPanel.openBrowserTab(path);
                }
            } else {
                window.rightPanel.open();
            }

            return {
                status: "rendered",
                title,
                mode: html ? "html" : "url",
                message: `Preview '${title}' rendered live in browser preview pane.`
            };
        }

        return {
            status: "rendered",
            title,
            mode: html ? "html" : "url",
            message: "Preview updated (simulated/headless mode)."
        };
    }
};

/**
 * Opens a URL in the browser preview pane.
 */
export const openBrowserTabTool = {
    name: "open_browser_tab",
    subagentOnly: true,
    schema: {
        type: "function",
        function: {
            name: "open_browser_tab",
            description: "Open a URL or web address in the workspace browser preview pane.",
            parameters: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "The URL or web address to load."
                    },
                    title: {
                        type: "string",
                        description: "Optional tab title."
                    }
                },
                required: ["url"]
            }
        }
    },
    handler: async (args) => {
        const url = args?.url || "";
        const title = args?.title || "Browser";

        if (typeof window !== "undefined" && window.rightPanel) {
            if (window.rightPanel.openBrowserTab) {
                window.rightPanel.openBrowserTab(url);
            }
            window.rightPanel.open();
            return {
                status: "opened",
                url,
                title,
                message: `Opened '${url}' in browser tab.`
            };
        }

        return {
            status: "opened",
            url,
            title,
            message: "Browser tab opened (simulated/headless mode)."
        };
    }
};

/**
 * Toggles or switches workspace preview panels and tabs.
 */
export const togglePanelTool = {
    name: "toggle_panel",
    subagentOnly: true,
    schema: {
        type: "function",
        function: {
            name: "toggle_panel",
            description: "Open, close, or toggle workspace preview panels and tabs (browser, review, terminal, file).",
            parameters: {
                type: "object",
                properties: {
                    panel: {
                        type: "string",
                        enum: ["browser", "review", "terminal", "file", "right", "side"],
                        description: "Which panel or tab to switch to or toggle."
                    },
                    action: {
                        type: "string",
                        enum: ["open", "close", "toggle"],
                        description: "Action to perform ('open', 'close', 'toggle'). Default is 'open'."
                    }
                }
            }
        }
    },
    handler: async (args) => {
        const panel = args?.panel || "browser";
        const action = args?.action || "open";

        if (typeof window !== "undefined" && window.rightPanel) {
            if (action === "close") {
                window.rightPanel.close();
            } else if (action === "toggle") {
                window.rightPanel.toggle();
            } else {
                window.rightPanel.open();
                if (panel === "browser" && window.rightPanel.openBrowserTab) {
                    window.rightPanel.openBrowserTab("about:blank");
                } else if (panel === "review" && window.rightPanel.openReviewTab) {
                    window.rightPanel.openReviewTab();
                } else if (panel === "terminal" && window.rightPanel.fuseTerminal) {
                    window.rightPanel.fuseTerminal();
                }
            }

            return {
                status: "success",
                panel,
                action,
                message: `Panel '${panel}' action '${action}' completed.`
            };
        }

        return {
            status: "success",
            panel,
            action,
            message: "Panel toggled (simulated/headless mode)."
        };
    }
};

export const designTools = [
    showHtmlPreviewTool,
    openBrowserTabTool,
    togglePanelTool
];
