// Standalone preview of the landing page (and the dashboard at /app). ES modules need HTTP, not file://.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname: .pathname leaves spaces percent-encoded and every request 404s
// when the folder name contains a space.
const root = fileURLToPath(new URL("..", import.meta.url)); // frontend/
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".mp4": "video/mp4" };

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/") path = "/landing/index.html";
    if (path === "/app") path = "/index.html";
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) throw new Error("outside root");
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
}).listen(Number(process.env.PORT) || 8123, "127.0.0.1", () => console.log(`http://127.0.0.1:${Number(process.env.PORT) || 8123}`));
