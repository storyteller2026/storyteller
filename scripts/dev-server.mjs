// Local stand-in for Vercel: serves /public and runs /api/*.js handlers.
// Usage: node scripts/dev-server.mjs  (reads a .env file in the project root if present)
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const envFile = join(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const port = Number(process.env.PORT || 3000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    const m = /^\/api\/([a-z0-9-]+)$/.exec(url.pathname);
    if (m) {
      const file = join(root, "api", `${m[1]}.js`);
      if (!existsSync(file)) { res.writeHead(404).end("Not found"); return; }
      const mod = await import(pathToFileURL(file).href);
      const fn = mod[req.method];
      if (!fn) { res.writeHead(405).end("Method not allowed"); return; }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks);
      const ac = new AbortController();
      res.on("close", () => { if (!res.writableEnded) ac.abort(); });
      const request = new Request(url, { method: req.method, headers: req.headers, body, signal: ac.signal });
      const response = await fn(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(res);
      else res.end();
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (path.endsWith("/")) path += "index.html";
    const file = join(root, "public", path);
    if (!file.startsWith(join(root, "public"))) { res.writeHead(403).end(); return; }
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(await readFile(file));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end("Server error");
  }
}).listen(port, () => console.log(`Storyteller running at http://localhost:${port}`));
