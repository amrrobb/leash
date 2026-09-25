import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { issueRpContext, handleProof } from "./flow.js";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
};

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error("body too large"), { status: 413 });
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error("invalid JSON"), { status: 400 });
  }
}

/** HTTP app. `deps`: { config, store, chain, demo?, fetchImpl?, staticDir } */
export function createApp(deps) {
  const { config, store, chain, demo, staticDir } = deps;
  const vault = config.deployments.vault;

  const routes = {
    "GET /api/health": async () => ({ ok: true }),
    "GET /api/deployment": async () => config.deployments,
    "GET /api/state": async () => chain.readState(),
    "GET /api/feed": async () => chain.readFeed(),
    "POST /api/rp-context": async () => issueRpContext({ world: config.world, store }),
    "POST /api/proof": async (body) =>
      handleProof({ result: body, world: config.world, store, chain, vault, fetchImpl: deps.fetchImpl }),
  };
  if (demo) {
    // Stand-ins for Alice's own wallet so the demo and e2e tests can drive owner actions.
    routes["POST /api/demo/set-cap"] = async (body) => ({ tx: await demo.setCap(BigInt(body.cap)) });
    routes["POST /api/demo/revoke"] = async () => ({ tx: await demo.revokeMandate() });
    routes["POST /api/demo/grant-mandate"] = async () => ({ tx: await demo.grantMandate() });
  }

  async function serveStatic(req, res) {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(staticDir, path === "/" ? "index.html" : path);
    if (!file.startsWith(staticDir)) return json(res, 403, { error: "forbidden" });
    try {
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(data);
    } catch {
      json(res, 404, { error: "not found" });
    }
  }

  return createServer(async (req, res) => {
    const key = `${req.method} ${new URL(req.url, "http://x").pathname}`;
    const route = routes[key];
    if (!route) {
      if (req.method === "GET" && staticDir) return serveStatic(req, res);
      return json(res, 404, { error: "not found" });
    }
    try {
      const body = req.method === "POST" ? await readBody(req) : undefined;
      json(res, 200, await route(body));
    } catch (err) {
      const status = err.status ?? 500;
      if (status >= 500) console.error(key, err);
      json(res, status, { error: err.shortMessage ?? err.message });
    }
  });
}
