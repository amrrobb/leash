// Real World staging round-trip against the hosted app (usage: node staging-roundtrip.mjs <vault>): the page's real IDKit issues the request, World's
// simulator completes it, World's portal verifies it, the backend grants the tier and stamps the vault.
import { chromium } from "@playwright/test";
const vault = process.argv[2];
const out = "/private/tmp/claude-501/-Users-ammar-robb-Documents-Web3-ETHGlobal/f5dc7337-26c2-414c-af0c-2c421a0477bf/scratchpad/";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
p.on("console", (m) => m.type() === "error" && console.log("console:", m.text().slice(0, 160)));
await p.goto(`https://leash.robbyn.xyz/app?vault=${vault}`);
await p.getByTestId("verify-again").click();
const link = p.locator("#vm-link");
await link.waitFor({ state: "visible", timeout: 30_000 });
const connect = await link.getAttribute("href");
console.log("connect url:", connect.slice(0, 60) + "…");
await p.screenshot({ path: out + "staging-qr.png" });
const res = await fetch("https://simulator.worldcoin.org/api/mcp", {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "complete_test_request", arguments: { connect_url: connect } } }),
});
const text = await res.text();
console.log("simulator:", res.status, text.slice(0, 300).replace(/\s+/g, " "));
await p.getByTestId("verify-modal").waitFor({ state: "hidden", timeout: 120_000 }).catch(() => console.log("modal still open"));
const err = await p.locator("#vm-err").textContent().catch(() => "");
if (err) console.log("page error:", err);
await p.waitForTimeout(3000);
await p.screenshot({ path: out + "staging-after.png" });
console.log("status:", await p.getByTestId("status").textContent(), "| last:", await p.locator("#last").textContent());
await b.close();
