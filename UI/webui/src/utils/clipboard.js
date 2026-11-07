/* =========================================================
   CLIPBOARD UTILITY (MODERN API + EXECCOMMAND FALLBACK)
   ========================================================= */

export async function copyTextToClipboard(text) {
    if (!text && text !== "0") return false;
    let copied = false;

    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            copied = true;
        } catch (e) {
            console.warn("navigator.clipboard.writeText failed, using fallback:", e);
        }
    }

    if (copied) return true;

    try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "-9999px";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        return copied;
    } catch (err) {
        console.error("execCommand fallback error:", err);
        return false;
    }
}

export function getMessageTextToCopy(msgEl) {
    if (!msgEl) return "";
    if (msgEl.dataset.rawText) {
        return msgEl.dataset.rawText;
    }
    if (msgEl.classList.contains("user")) {
        const textEl = msgEl.querySelector(".msg-bubble-text");
        if (textEl) return textEl.textContent.trim();
        return msgEl.textContent.trim();
    }

    const finalEl = msgEl.querySelector(".final-content");
    if (finalEl) {
        const clone = finalEl.cloneNode(true);
        clone.querySelectorAll(".code-copy-btn, .code-mode-pill, .code-lang-line").forEach(el => el.remove());
        return (clone.innerText || clone.textContent).trim();
    }
    return msgEl.innerText.trim();
}
