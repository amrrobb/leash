// Plays the human when no phone with a World credential is at hand: hands the page's "Open in World App"
// link to World's simulator, which generates a real native World ID 4.0 *staging* proof and delivers it
// through the IDKit bridge. The backend then verifies it with World's portal exactly as it would a phone's.
// Needs the backend in staging mode (WORLD_ENVIRONMENT=staging, WORLD_ALLOW_LEGACY unset, a live staging window).
//   node simulate-human.mjs "<link copied from the modal>"
const url = process.argv[2];
if (!url?.startsWith("https://")) throw new Error('usage: node simulate-human.mjs "<Open in World App link>"');
if (!url.startsWith("https://staging.world.org/")) console.warn("warning: this is not a staging link; the simulator will refuse it");

const res = await fetch("https://simulator.worldcoin.org/api/mcp", {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "complete_test_request", arguments: { connect_url: url } } }),
});
const text = await res.text();
const json = JSON.parse(text.slice(text.indexOf("{")));
const out = json.result?.structuredContent ?? JSON.parse(json.result?.content?.[0]?.text ?? "{}");
if (out.status === "proof_delivered") console.log(`proof delivered (request ${out.request_id}); the page verifies it with World now`);
else {
  console.error("simulator refused:", JSON.stringify(out));
  process.exit(1);
}
