import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rpc, agent } from "../setup.js";

const shot = (name) => fileURLToPath(new URL(`../.tmp/shots/${name}.png`, import.meta.url));
const fakeIDKit = readFileSync(fileURLToPath(new URL("../fake-idkit.js", import.meta.url)), "utf8");

const state = async (request) => (await request.get("/api/state")).json();

/** Moves chain time to exactly `seconds` after the last verification, whatever happened before. */
async function warpSinceVerify(request, seconds) {
  const s = await state(request);
  await rpc("evm_setNextBlockTimestamp", [Number(s.lastVerified) + seconds]);
  await rpc("evm_mine");
}

/** Chain time follows wall time on Anvil and every real second is 0.4 demo hours, so "just verified"
 * reads a little under the cap. Assert a range, never an exact figure. */
async function expectAuthorityBetween(page, lo, hi) {
  await expect
    .poll(async () => Number((await page.getByTestId("authority").textContent()).replace(/,/g, "")))
    .toBeGreaterThanOrEqual(lo);
  const shown = Number((await page.getByTestId("authority").textContent()).replace(/,/g, ""));
  expect(shown).toBeLessThanOrEqual(hi);
}

const usd = (s) => Number(s) / 1e6;

/** Opens the World modal via `testId` and answers as World App would. Clears any stale handle
 * first, so the answer can only reach the request this click created. */
async function worldAnswers(page, testId, answer) {
  await page.evaluate(() => { window.__world = null; });
  await page.getByTestId(testId).click();
  await page.waitForFunction(() => window.__world);
  await page.evaluate(answer);
}

test.describe.serial("Leash journey on a Sepolia fork", () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.route("**/vendor/idkit.global.js", (route) => route.fulfill({ contentType: "text/javascript", body: fakeIDKit }));
    await page.goto("/");
  });

  test("State A: no mandate yet, tiers are read-only", async () => {
    await expect(page.getByTestId("state-a")).toBeVisible();
    await page.screenshot({ path: shot("state-a") });
    await expect(page.getByText("Give your agent permission")).toBeVisible();
    await expect(page.locator(".tier")).toHaveCount(3);
    await expect(page.getByTestId("dashboard")).toBeHidden();
  });

  test("World cancel path: nothing is granted", async ({ request }) => {
    await page.evaluate(() => { window.__world = null; });
    await page.getByTestId("verify-with-world").click();
    await expect(page.getByTestId("verify-modal")).toBeVisible();
    await expect(page.getByTestId("qr")).toHaveAttribute("data-uri", /world\.org/);
    await page.getByTestId("verify-cancel").click();
    await expect(page.getByTestId("verify-modal")).toBeHidden();
    await expect(page.getByTestId("cancelled")).toHaveText("Verification cancelled. Nothing was granted.");
    const s = await state(request);
    expect(s.lastVerified).toBe("0");
  });

  test("World App decline: error shown, still nothing on chain", async ({ request }) => {
    await worldAnswers(page, "verify-with-world", () => window.__world.decline());
    await expect(page.getByTestId("verify-error")).toContainText("declined");
    await page.getByTestId("verify-cancel").click();
    expect((await state(request)).lastVerified).toBe("0");
  });

  test("Verify with Selfie Check -> A' prefilled at 2,000 and capped there", async () => {
    await worldAnswers(page, "verify-with-world", () => window.__world.approve("selfie"));
    await expect(page.getByTestId("state-a2")).toBeVisible();
    await expect(page.getByText("Verified · Selfie Check")).toBeVisible();
    await expect(page.getByTestId("starting-authority")).toHaveValue("2000");
    await page.screenshot({ path: shot("state-a2") });
    await page.getByTestId("starting-authority").fill("5000");
    await page.getByTestId("create-mandate").click();
    await expect(page.getByText(/can only go down/).last()).toBeVisible();
    await page.getByTestId("starting-authority").fill("2000");
  });

  test("Create mandate -> State B operating at 2,000 USDC", async ({ request }) => {
    await page.getByTestId("create-mandate").click();
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await expect(page.getByTestId("status")).toHaveText("Operating");
    await expectAuthorityBetween(page, 1_800, 2_000);
    await expect(page.getByTestId("open-perm")).toHaveText("Allowed");
    await expect(page.getByTestId("close-perm")).toHaveText("Always");
    await expect(page.getByTestId("feed")).toContainText("You set the mandate");
    await expect(page.getByTestId("feed")).toContainText("You verified with World");
    const s = await state(request);
    expect(s.ownerCap).toBe("2000000000");
    expect(usd(s.cap)).toBeGreaterThan(1_800);
    expect(usd(s.cap)).toBeLessThanOrEqual(2_000);
    await page.screenshot({ path: shot("state-b") });
  });

  test("Agent ships; a 10,000 USDC market trade is trimmed to the live cap", async () => {
    agent("ship");
    await expect(page.getByTestId("feed")).toContainText("Agent opened a range");
    const out = agent("trade", { AMOUNT: "10000000000" });
    const filled = Number(out.match(/simulated fill \(USDC\) (\d+)/)[1]) / 1e6; // pre-broadcast figure; the feed shows the mined one
    expect(filled).toBeGreaterThan(1_800);
    expect(filled).toBeLessThanOrEqual(2_000);
    const row = page.locator('[data-kind="trim"]').first();
    await expect(row).toContainText("Asked 10,000 · allowed");
    await expect(row).toContainText("Trimmed");
  });

  test("Decay: 36 demo hours later the dashboard turns ochre and trims", async ({ request }) => {
    await warpSinceVerify(request, 90); // 90 s x 1440 = 36 demo hours -> 750 of 2,000
    await expect(page.getByTestId("status")).toHaveText("Trimming fills");
    const shown = Number((await page.getByTestId("authority").textContent()).replace(/,/g, ""));
    expect(shown).toBeLessThanOrEqual(750);
    expect(shown).toBeGreaterThan(600);
    const onChain = Number((await state(request)).cap) / 1e6;
    expect(Math.abs(onChain - shown)).toBeLessThan(40);
    await page.screenshot({ path: shot("state-b-trim") });
  });

  test("State C: 72 demo hours without a human -> close-only, grey, not red", async ({ request }) => {
    await warpSinceVerify(request, 185);
    await expect(page.getByTestId("status")).toHaveText("Close-only");
    await expect(page.getByTestId("authority")).toHaveText("0");
    await expect(page.getByTestId("reaches-zero")).toHaveText("Reached");
    await expect(page.getByTestId("open-perm")).toHaveText("Paused");
    await expect(page.getByTestId("close-perm")).toHaveText("Always");
    await expect(page.getByTestId("c-note")).toContainText("Nobody verified for 3 days");
    await expect(page.getByTestId("withdraw")).toBeVisible();
    expect((await state(request)).cap).toBe("0");
    const bg = await page.getByTestId("status").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe("rgb(236, 234, 227)");
    await page.screenshot({ path: shot("state-c") });
  });

  test("In C the market is refused but the agent can still close", async () => {
    expect(() => agent("trade", { AMOUNT: "1000000000" })).toThrow(/MandateEmpty/);
    agent("dock");
    await expect(page.getByTestId("feed")).toContainText("Agent closed the position");
  });

  test("C -> B recovery: verifying again restores the cap on chain", async ({ request }) => {
    await worldAnswers(page, "verify-again", () => window.__world.approve("selfie"));
    await expect(page.getByTestId("status")).toHaveText("Operating");
    await expectAuthorityBetween(page, 1_800, 2_000);
    expect(usd((await state(request)).cap)).toBeGreaterThan(1_800);
  });

  test("Portal rejection: the proof fails server-side, no transaction", async ({ request }) => {
    const before = (await state(request)).lastVerified;
    await worldAnswers(page, "verify-again", () => window.__world.approve("selfie", "0xportal-reject"));
    await expect(page.getByTestId("verify-error")).toContainText("World rejected the proof");
    await page.getByTestId("verify-cancel").click();
    expect((await state(request)).lastVerified).toBe(before);
  });

  test("Revoke: Alice pulls the mandate, the page says so and goes close-only", async ({ request }) => {
    await page.getByTestId("revoke").click();
    await expect(page.getByTestId("status")).toHaveText("Close-only");
    await expect(page.getByTestId("c-note")).toHaveText("You revoked the mandate.");
    await expect(page.getByTestId("revoke")).toBeHidden();
    await expect(page.getByTestId("verify-again")).toBeHidden();
    await expect(page.getByTestId("restore")).toBeVisible();
    const s = await state(request);
    expect(s.alive).toBe(false);
    expect(s.cap).toBe("0");
  });

  test("Withdraw: the owner takes the funds home", async () => {
    await page.getByTestId("withdraw").click();
    await expect(page.getByTestId("feed")).toContainText("You withdrew");
  });

  test("Restore: only Alice can bring a revoked mandate back", async ({ request }) => {
    await page.getByTestId("restore").click();
    await expect(page.getByTestId("status")).not.toHaveText("Close-only");
    await expect(page.getByTestId("verify-again")).toBeVisible();
    const s = await state(request);
    expect(s.alive).toBe(true);
    expect(usd(s.cap)).toBeGreaterThan(0);
  });
});
