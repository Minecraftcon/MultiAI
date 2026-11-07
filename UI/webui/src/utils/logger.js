/* =========================================================
   TELEMETRY LOGGER UTILITY
   ========================================================= */

export function logEvent(tag, data) {
    try {
        fetch("/api/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tag, ...data })
        }).catch(() => {});
    } catch (e) {}
}
