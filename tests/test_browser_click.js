const http = require("http");
const { spawn } = require("child_process");

async function main() {
    const chrome = spawn("google-chrome", [
        "--headless=new",
        "--remote-debugging-port=9224",
        "--user-data-dir=/tmp/chrome_test_profile_9224",
        "--no-sandbox",
        "about:blank"
    ]);

    await new Promise(r => setTimeout(r, 1500));

    // Get targets
    const targets = await new Promise((resolve, reject) => {
        http.get("http://127.0.0.1:9224/json", res => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => resolve(JSON.parse(data)));
        }).on("error", reject);
    });

    const pageTarget = targets.find(t => t.type === "page");
    if (!pageTarget) {
        console.error("No page target found");
        chrome.kill();
        return;
    }

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    let id = 1;
    const callbacks = new Map();

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.method === "Runtime.consoleAPICalled") {
            console.log("[BROWSER CONSOLE]", msg.params.type, msg.params.args.map(a => a.value || a.description).join(" "));
        } else if (msg.method === "Runtime.exceptionThrown") {
            console.error("[BROWSER EXCEPTION]", JSON.stringify(msg.params.exceptionDetails));
        }
        if (msg.id && callbacks.has(msg.id)) {
            callbacks.get(msg.id)(msg);
            callbacks.delete(msg.id);
        }
    };

    function send(method, params = {}) {
        return new Promise(resolve => {
            const reqId = id++;
            callbacks.set(reqId, resolve);
            ws.send(JSON.stringify({ id: reqId, method, params }));
        });
    }

    await new Promise(r => ws.onopen = r);

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");

    console.log("Navigating to http://localhost:4440...");
    await send("Page.navigate", { url: "http://localhost:4440" });

    // Wait for bootstrap & fetch /api/chats
    await new Promise(r => setTimeout(r, 3000));

    // 1. Initial State
    const stateEval = await send("Runtime.evaluate", {
        expression: `(() => {
            const shell = document.getElementById("appShell");
            const chat = document.getElementById("chat");
            const chatList = document.getElementById("chatList");
            const items = Array.from(chatList?.querySelectorAll(".chat-item") || []).map(el => ({
                id: el.dataset.chatId,
                title: el.querySelector(".chat-item-title")?.textContent,
                isActive: el.classList.contains("active")
            }));
            return {
                currentChatId: window.state?.currentChatId,
                isStartPage: shell?.classList.contains("is-start-page"),
                chatChildren: chat?.children.length,
                renderedChatItems: items.slice(0, 5)
            };
        })()`,
        returnByValue: true
    });
    console.log("Initial Page State:", JSON.stringify(stateEval.result?.result?.value, null, 2));

    // 2. Click the second chat item
    console.log("Simulating click on second chat item...");
    const clickEval = await send("Runtime.evaluate", {
        expression: `(async () => {
            const items = document.querySelectorAll("#chatList .chat-item");
            if (items.length < 2) return { error: "less than 2 items" };
            const targetItem = items[1];
            const targetId = targetItem.dataset.chatId;
            console.log("Clicking targetItem with ID:", targetId);
            targetItem.click();
            // Wait for any async fetch in switchToChat
            await new Promise(r => setTimeout(r, 1000));
            const shell = document.getElementById("appShell");
            const chat = document.getElementById("chat");
            return {
                clickedId: targetId,
                currentChatId: window.state?.currentChatId,
                isStartPage: shell?.classList.contains("is-start-page"),
                chatChildren: chat?.children.length,
                chatHtmlSample: chat?.innerHTML.slice(0, 200)
            };
        })()`,
        awaitPromise: true,
        returnByValue: true
    });
    console.log("After clicking second item:", JSON.stringify(clickEval.result?.result?.value, null, 2));

    // 3. Click the first chat item
    console.log("Simulating click on first chat item...");
    const clickEval2 = await send("Runtime.evaluate", {
        expression: `(async () => {
            const items = document.querySelectorAll("#chatList .chat-item");
            if (items.length < 1) return { error: "no items" };
            const targetItem = items[0];
            const targetId = targetItem.dataset.chatId;
            console.log("Clicking targetItem with ID:", targetId);
            targetItem.click();
            await new Promise(r => setTimeout(r, 1000));
            const shell = document.getElementById("appShell");
            const chat = document.getElementById("chat");
            return {
                clickedId: targetId,
                currentChatId: window.state?.currentChatId,
                isStartPage: shell?.classList.contains("is-start-page"),
                chatChildren: chat?.children.length,
                chatHtmlSample: chat?.innerHTML.slice(0, 200)
            };
        })()`,
        awaitPromise: true,
        returnByValue: true
    });
    console.log("After clicking first item:", JSON.stringify(clickEval2.result?.result?.value, null, 2));

    ws.close();
    chrome.kill();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
