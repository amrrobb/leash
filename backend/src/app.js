import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { issueRpContext, handleProof, describeResult } from "./flow.js";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".wasm": "application/wasm" };
const ADDR = /^0x[0-9a-fA-F]{40}$/;

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

const AGENT_KINDS = new Set(["blocked", "closed", "full", "trim"]);

/** Chain events and the agent's own reports, newest first. */
export function mergeFeed(chainFeed, agentEvents, limit = 12) {
  return [...chainFeed, ...agentEvents].sort((x, y) => y.at - x.at || y.block - x.block || y.logIndex - x.logIndex).slice(0, limit);
}

/** Test-only signing and agent reports answer only on loopback or with the DEMO_TOKEN header. */
export function demoAllowed(req, token) {
  const ip = req.socket?.remoteAddress ?? "";
  const loopback = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  return loopback || (Boolean(token) && req.headers["x-demo-token"] === token);
}

/** HTTP app. `deps`: { config, store, chain, signer?, demoToken?, fetchImpl?, staticDir, vendorDir? } */
export function createApp(deps) {
  const { config, store, chain, signer, staticDir } = deps;
  const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

  async function vaultParam(q) {
    const vault = q.get("vault");
    if (!(await chain.isKnownVault(vault))) throw bad("unknown vault");
    return vault;
  }

  const routes = {
    "GET /api/health": async () => ({ ok: true }),
    "GET /api/deployment": async () => ({ ...config.deployments, policy: await chain.policy().catch(() => null) }),
    /** Which vault a wallet owns (zero address if none). */
    "GET /api/vault": async (_b, q) => {
      const owner = q.get("owner");
      if (!ADDR.test(owner ?? "")) throw bad("owner must be an address");
      return { owner, vault: await chain.vaultOf(owner) };
    },
    "GET /api/state": async (_b, q) => chain.readState(await vaultParam(q)),
    "GET /api/feed": async (_b, q) => {
      const vault = await vaultParam(q);
      return mergeFeed(await chain.readFeed(vault, 20), store.recentEvents(vault, 20));
    },
    /** Calldata for the owner's wallet: { to, data }. The wallet signs; the backend never holds owner keys. */
    "GET /api/tx": async (_b, q) => {
      const kind = q.get("kind");
      const p = Object.fromEntries(q.entries());
      if (kind !== "createVault") p.vault = await vaultParam(q);
      return chain.buildTx(kind, p);
    },
    "POST /api/rp-context": async () => issueRpContext({ world: config.world, store }),
    "POST /api/proof": async (body) =>
      handleProof({ result: body?.result, vault: body?.vault, world: config.world, store, chain, fetchImpl: deps.fetchImpl }),
    // The agent reports what it tried; a refused ship reverts and leaves nothing on chain otherwise.
    "POST /api/agent/event": async (body) => {
      if (!AGENT_KINDS.has(body?.kind) || typeof body.title !== "string" || typeof body.detail !== "string") throw bad("kind, title, detail required");
      if (!(await chain.isKnownVault(body.vault))) throw bad("unknown vault");
      store.addEvent(body.vault, body.kind, body.title.slice(0, 120), body.detail.slice(0, 200));
      return { ok: true };
    },
  };
  if (signer) {
    // A wallet stand-in for browser tests: signs whatever calldata the page would have sent to a wallet.
    routes["POST /api/demo/send"] = async (body) => ({ tx: await signer.send(body.to, body.data, body.value ?? "0") });
    routes["POST /api/demo/reset-human"] = async (body) => ({ removed: store.unbindVault(body?.vault ?? "") });
    routes["GET /api/demo/address"] = async () => ({ address: signer.address });
  }

  async function serveStatic(req, res) {
    let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    let dir = staticDir;
    if (deps.vendorDir && path.startsWith("/vendor/")) {
      dir = deps.vendorDir;
      path = path.slice("/vendor".length);
    }
    // "/" is the landing page when one exists, else the dashboard; "/app" is always the dashboard.
    if (path === "/app") path = "/index.html";
    if (path === "/" && existsSync(join(staticDir, "landing", "index.html"))) path = "/landing/index.html";
    if (path === "/b") path = "/landing-b/index.html"; // variant landing, for side-by-side comparison
    const file = join(dir, path === "/" ? "index.html" : path);
    if (!file.startsWith(dir)) return json(res, 403, { error: "forbidden" });
    try {
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(data);
    } catch {
      json(res, 404, { error: "not found" });
    }
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const key = `${req.method} ${url.pathname}`;
    const route = routes[key];
    if (!route) {
      if ((req.method === "GET" || req.method === "HEAD") && staticDir) return serveStatic(req, res); // HEAD: link checkers
      return json(res, 404, { error: "not found" });
    }
    if ((key.startsWith("POST /api/demo/") || key.startsWith("GET /api/demo/") || key === "POST /api/agent/event") && !demoAllowed(req, deps.demoToken)) {
      return json(res, 403, { error: "local-only route" });
    }
    let body;
    try {
      body = req.method === "POST" ? await readBody(req) : undefined;
      json(res, 200, await route(body, url.searchParams));
    } catch (err) {
      const status = err.status ?? 500;
      if (status >= 500) console.error(key, err);
      else if (key === "POST /api/proof") console.warn(`proof rejected (${status}): ${err.message}`, JSON.stringify(describeResult(body?.result)));
      // viem hides the RPC's reason in `details` ("in-flight transaction limit reached for delegated accounts").
      const detail = err.details && err.details !== err.shortMessage ? ` (${err.details})` : "";
      json(res, status, { error: (err.shortMessage ?? err.message) + detail });
    }
  });
}
