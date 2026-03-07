// save as /tmp/mock-eventbrite.cjs
const http = require("http");
const mode = process.env.MOCK_MODE || "live_future"; // canceled | live_future | live_past

http.createServer((req, res) => {
    const m = req.url.match(/^\/v3\/events\/([^/]+)\/?$/);
    if (!m) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "not found" }));
    }

    const id = decodeURIComponent(m[1]);
    const now = Math.floor(Date.now() / 1000);
    const endTs = mode === "live_past" ? now - 3600 : now + 7200;

    const body = {
        id,
        name: { text: "Mock Event" },
        url: `https://www.eventbrite.com/e/mock-${id}`,
        online_event: false,
        status: mode === "canceled" ? "canceled" : "live",
        start: { utc: new Date((now + 1800) * 1000).toISOString() },
        end: { utc: new Date(endTs * 1000).toISOString() },
        ...(mode === "canceled" ? { canceled_at: new Date().toISOString() } : {}),
    };

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
}).listen(8787, "127.0.0.1", () => {
    console.log("Mock Eventbrite listening at http://127.0.0.1:8787");
});
