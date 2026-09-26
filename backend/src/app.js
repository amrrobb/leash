import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { issueRpContext, handleProof, describeResult } from "./flow.js";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".wasm": "application/wasm" };

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

/** Demo owner routes sign as Alice, so they answer only on loopback or with the DEMO_TOKEN header. */
export function demoAllowed(req, token) {
  const ip = req.socket?.remoteAddress ?? "";
  const loopback = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  return loopback || (Boolean(token) && req.headers["x-demo-token"] === token);
}

const AGENT_KINDS = new Set(["blocked", "closed", "full", "trim"]);

/** Chain events and the agent's own reports, newest first. */
export function mergeFeed(chainFeed, agentEvents, limit = 12) {
  return [...chainFeed, ...agentEvents].sort((x, y) => y.at - x.at || y.block - x.block || y.logIndex - x.logIndex).slice(0, limit);
}

/** HTTP app. `deps`: { config, store, chain, demo?, demoToken?, fetchImpl?, staticDir, vendorDir? } */
export function createApp(deps) {
  const { config, store, chain, demo, staticDir } = deps;
  const vault = config.deployments.vault;

  const routes = {
    "GET /api/health": async () => ({ ok: true }),
    "GET /api/deployment": async () => config.deployments,
    "GET /api/state": async () => chain.readState(),
    "GET /api/feed": async () => mergeFeed(await chain.readFeed(20), store.recentEvents(20)),
    // The agent reports what it tried; a refused ship reverts and leaves nothing on chain otherwise.
    "POST /api/agent/event": async (body) => {
      if (!AGENT_KINDS.has(body?.kind) || typeof body.title !== "string" || typeof body.detail !== "string") throw Object.assign(new Error("kind, title, detail required"), { status: 400 });
      store.addEvent(body.kind, body.title.slice(0, 120), body.detail.slice(0, 200));
      return { ok: true };
    },
    "POST /api/rp-context": async () => issueRpContext({ world: config.world, store }),
    "POST /api/proof": async (body) =>
      handleProof({ result: body, world: config.world, store, chain, vault, fetchImpl: deps.fetchImpl }),
  };
  if (demo) {
    // Stand-ins for Alice's own wallet so the demo and e2e tests can drive owner actions.
    routes["POST /api/demo/set-cap"] = async (body) => ({ tx: await demo.setCap(BigInt(body.cap)) });
    routes["POST /api/demo/revoke"] = async () => ({ tx: await demo.revokeMandate() });
    routes["POST /api/demo/grant-mandate"] = async () => ({ tx: await demo.grantMandate() });
    routes["POST /api/demo/withdraw"] = async () => ({ tx: await demo.withdrawAll() });
    routes["POST /api/demo/deposit"] = async (body) => {
      const usdc = BigInt(body?.usdc ?? 0), hype = BigInt(body?.hype ?? 0);
      const txs = await demo.deposit(usdc, hype);
      const parts = [usdc > 0n && `${(Number(usdc) / 1e6).toLocaleString("en-US")} USDC`, hype > 0n && `${(Number(hype) / 1e18).toLocaleString("en-US")} HYPE`].filter(Boolean);
      store.addEvent("owner", "You deposited", `${parts.join(" · ")} into your vault`);
      return { txs };
    };
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
    const key = `${req.method} ${new URL(req.url, "http://x").pathname}`;
    const route = routes[key];
    if (!route) {
      if ((req.method === "GET" || req.method === "HEAD") && staticDir) return serveStatic(req, res); // HEAD: link checkers
      return json(res, 404, { error: "not found" });
    }
    let body;
    if ((key.startsWith("POST /api/demo/") || key === "POST /api/agent/event") && !demoAllowed(req, deps.demoToken)) return json(res, 403, { error: "local-only route" });
    try {
      body = req.method === "POST" ? await readBody(req) : undefined;
      json(res, 200, await route(body));
    } catch (err) {
      const status = err.status ?? 500;
      if (status >= 500) console.error(key, err);
      else if (key === "POST /api/proof") console.warn(`proof rejected (${status}): ${err.message}`, JSON.stringify(describeResult(body)));
      // viem hides the RPC's reason in `details` ("in-flight transaction limit reached for delegated accounts").
      const detail = err.details && err.details !== err.shortMessage ? ` (${err.details})` : "";
      json(res, status, { error: (err.shortMessage ?? err.message) + detail });
    }
  });
}
