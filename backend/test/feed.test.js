import { test } from "node:test";
import assert from "node:assert/strict";
import { toFeed } from "../src/chain.js";

const USDC = "0xa44B82a82383c4251a9BFed2532c78e56B97683F";
const HYPE = "0xa2840E991C00e6A99d2A94f44491139F19109375";
const log = (eventName, blockNumber, args = {}, logIndex = 0) => ({ eventName, blockNumber, args, logIndex, transactionHash: "0x" + blockNumber });

test("feed is newest first and labels each event", () => {
  const logs = [log("Verified", 10n), log("CapSet", 11n, { cap: 2_000_000_000n }), log("Shipped", 12n), log("Docked", 13n)];
  const feed = toFeed(logs, { usdc: USDC, blockTimes: new Map([[10n, 100n], [11n, 112n], [12n, 124n], [13n, 136n]]) });
  assert.deepEqual(feed.map((e) => e.kind), ["closed", "full", "owner", "you"]);
  assert.equal(feed[2].detail, "Authority up to 2,000 USDC");
  assert.equal(feed[0].at, 136);
});

test("a swap reports its USDC leg whichever side it is on", () => {
  const usdcIn = log("Swapped", 5n, { tokenIn: USDC, tokenOut: HYPE, amountIn: 2_000_000_000n, amountOut: 1n });
  const usdcOut = log("Swapped", 6n, { tokenIn: HYPE, tokenOut: USDC, amountIn: 1n, amountOut: 1_500_000_000n });
  const feed = toFeed([usdcIn, usdcOut], { usdc: USDC, blockTimes: new Map() });
  assert.equal(feed[0].detail, "1,500 USDC filled");
  assert.equal(feed[1].detail, "2,000 USDC filled");
});

test("same-block events keep log order", () => {
  const feed = toFeed([log("Verified", 7n, {}, 0), log("CapSet", 7n, { cap: 1n }, 1)], { usdc: USDC, blockTimes: new Map() });
  assert.deepEqual(feed.map((e) => e.title), ["You set the mandate", "You verified with World"]);
});
