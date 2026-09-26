import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rpc, agent, attack } from "../setup.js";
import { writeFileSync } from "node:fs";

const shot = (name) => fileURLToPath(new URL(`../.tmp/shots/${name}.png`, import.meta.url));
const fakeIDKit = readFileSync(fileURLToPath(new URL("../fake-idkit.js", import.meta.url)), "utf8");
const fakeWallet = readFileSync(fileURLToPath(new URL("../fake-wallet.js", import.meta.url)), "utf8");
const keys = JSON.parse(readFileSync(fileURLToPath(new URL("../.tmp/keys.json", import.meta.url)), "utf8"));

let vault = null;
const state = async (request) => (await request.get(`/api/state?vault=${vault}`)).json();
const usd = (s) => Number(s) / 1e6;

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

/** Opens the World modal via `testId` and answers as World App would. Clears any stale handle
 * first, so the answer can only reach the request this click created. */
async function worldAnswers(page, testId, answer) {
  await page.evaluate(() => { window.__world = null; });
  await page.getByTestId(testId).click();
  await page.waitForFunction(() => window.__world);
  await page.evaluate(answer);
}

test.describe.serial("Leash journey on a Sepolia fork: any wallet, its own vault", () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.addInitScript(fakeWallet);
    await page.route("**/vendor/idkit.global.js", (route) => route.fulfill({ contentType: "text/javascript", body: fakeIDKit }));
    await page.goto("/app");
  });

  test("Connect: nothing to look at until a wallet connects", async () => {
    await expect(page.getByTestId("state-connect")).toBeVisible();
    await expect(page.locator(".tier")).toHaveCount(3);
    await page.screenshot({ path: shot("0-connect") });
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("state-create")).toBeVisible();
    await expect(page.getByTestId("owner-name")).toHaveText(/^0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/);
  });

  test("Create your vault: one transaction makes the vault, the ENS name and the agent's mandate", async ({ request }) => {
    await page.getByTestId("agent-label").fill("Alice-Agent");
    await page.getByTestId("agent-address").fill(keys.addr.agent);
    await page.screenshot({ path: shot("1-create") });
    await page.getByTestId("create-vault").click();
    await expect(page.getByTestId("state-a")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("alice-agent.leash.eth").first()).toBeVisible();
    vault = await page.evaluate(() => window.leash.session.vault);
    expect(vault).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const s = await state(request);
    expect(s.alive).toBe(true);
    expect(s.ownerCap).toBe("0");
    expect(s.agentLabel).toBe("alice-agent");
    expect(page.url()).toContain(`vault=${vault}`);
  });

  test("World cancel path: nothing is granted", async ({ request }) => {
    await page.evaluate(() => { window.__world = null; });
    await page.getByTestId("verify-with-world").click();
    await expect(page.getByTestId("verify-modal")).toBeVisible();
    await expect(page.getByTestId("qr")).toHaveAttribute("data-uri", /world\.org/);
    await page.getByTestId("verify-cancel").click();
    await expect(page.getByTestId("verify-modal")).toBeHidden();
    await expect(page.getByTestId("cancelled")).toHaveText("Verification cancelled. Nothing was granted.");
    expect((await state(request)).lastVerified).toBe("0");
  });

  test("World App decline: error shown, still nothing on chain", async ({ request }) => {
    await worldAnswers(page, "verify-with-world", () => window.__world.decline());
    await expect(page.getByTestId("verify-error")).toContainText("declined");
    await page.getByTestId("verify-cancel").click();
    expect((await state(request)).lastVerified).toBe("0");
  });

  test("Verify with Selfie Check -> A' prefilled at 2,000 and capped there; the owner funds the vault", async () => {
    await worldAnswers(page, "verify-with-world", () => window.__world.approve("selfie"));
    await expect(page.getByTestId("state-a2")).toBeVisible();
    await expect(page.getByText("Verified · Selfie Check")).toBeVisible();
    await expect(page.getByTestId("a2-name")).toHaveText("alice-agent.leash.eth");
    await expect(page.getByTestId("starting-authority")).toHaveValue("2000");
    await page.getByTestId("starting-authority").fill("5000");
    await page.getByTestId("create-mandate").click();
    await expect(page.getByText(/can only go down/).last()).toBeVisible();
    await page.getByTestId("starting-authority").fill("2000");
    await expect(page.getByTestId("a2-balances")).toHaveText("0 USDC · 0 HYPE");
    await page.getByTestId("a2-deposit").click();
    await expect(page.getByTestId("a2-balances")).toHaveText("10,000 USDC · 1,000 HYPE", { timeout: 60_000 });
    await page.screenshot({ path: shot("2-a2") });
  });

  test("Set the starting authority -> State B operating at 2,000 USDC", async ({ request }) => {
    await page.getByTestId("create-mandate").click();
    await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("status")).toHaveText("Operating");
    await expectAuthorityBetween(page, 1_800, 2_000);
    await expect(page.getByTestId("open-perm")).toHaveText("Allowed");
    await expect(page.getByTestId("close-perm")).toHaveText("Always");
    await expect(page.getByTestId("agent-name")).toHaveText("alice-agent.leash.eth");
    await expect(page.getByTestId("vault-balances")).toHaveText("10,000 USDC · 1,000 HYPE");
    await expect(page.getByTestId("feed")).toContainText("You set the mandate");
    await expect(page.getByTestId("feed")).toContainText("You verified with World");
    await expect(page.getByTestId("viewer-note")).toBeHidden();
    const s = await state(request);
    expect(s.ownerCap).toBe("2000000000");
    expect(usd(s.cap)).toBeGreaterThan(1_800);
    await page.screenshot({ path: shot("3-b") });
  });

  test("Agent ships; a 10,000 USDC market trade is trimmed to the live cap", async () => {
    agent("ship", { VAULT: vault });
    await expect(page.getByTestId("feed")).toContainText("Agent opened a range");
    const out = agent("trade", { VAULT: vault, AMOUNT: "10000000000" });
    const filled = Number(out.match(/simulated fill \(USDC\) (\d+)/)[1]) / 1e6; // pre-broadcast figure; the feed shows the mined one
    expect(filled).toBeGreaterThan(1_800);
    expect(filled).toBeLessThanOrEqual(2_000);
    const row = page.locator('[data-kind="trim"]').first();
    await expect(row).toContainText("Asked 10,000 · allowed");
    await expect(row).toContainText("Trimmed");
  });

  test("A prompt-injected agent tries everything; the chain refuses every attempt", async () => {
    // The agent script keeps the open position in a state file; give the attack script the same one.
    const salt = "7";
    writeFileSync(fileURLToPath(new URL("../../agent/.state.e2e.json", import.meta.url)), JSON.stringify({ position: { salt, pair: "HYPE", other: (await (await page.request.get("/api/deployment")).json()).hype, since: Date.now() } }));
    const out = attack(vault);
    expect(out).toMatch(/1\. Withdraw the whole vault to itself\s+refused: NotOwner/);
    expect(out).toMatch(/2\. Raise its own ceiling to the Orb tier\s+refused: EACCannotGrantRoles/);
    expect(out).toMatch(/3\. Renew its own permission.*refused: NotBackend/);
    expect(out).toMatch(/4\. Set the cap to unlimited\s+refused: NotOwner/);
    expect(out).toMatch(/5\. Open a position the cap cannot see.*refused: CapTokenMissing/);
    expect(out).toMatch(/6\. A trade asks for 100,000 USDC in one fill\s+filled only [\d,]+ USDC/);
    expect(out).toMatch(/6\/6 attempts refused/);
    await expect(page.getByTestId("feed")).toContainText("Agent tried to withdraw the vault");
    const trimmed = page.locator('[data-kind="trim"]').first();
    await expect(trimmed).toContainText("Asked 100,000 · allowed");
  });

  test("Decay: 36 demo hours later the dashboard turns ochre and trims", async ({ request }) => {
    await warpSinceVerify(request, 90); // 90 s x 1440 = 36 demo hours -> 750 of 2,000
    await expect(page.getByTestId("status")).toHaveText("Trimming fills");
    const shown = Number((await page.getByTestId("authority").textContent()).replace(/,/g, ""));
    expect(shown).toBeLessThanOrEqual(750);
    expect(shown).toBeGreaterThan(600);
    const onChain = usd((await state(request)).cap);
    expect(Math.abs(onChain - shown)).toBeLessThan(40);
    await page.screenshot({ path: shot("4-b-trim") });
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
    await page.screenshot({ path: shot("5-c") });
  });

  test("In C the market is refused but the agent can still close", async () => {
    expect(() => agent("trade", { VAULT: vault, AMOUNT: "1000000000" })).toThrow(/MandateEmpty/);
    agent("dock", { VAULT: vault });
    await expect(page.getByTestId("feed")).toContainText("Agent closed the position");
  });

  test("C -> B recovery: the same human verifies again and the cap is restored on chain", async ({ request }) => {
    await worldAnswers(page, "verify-again", () => window.__world.approve("selfie"));
    await expect(page.getByTestId("status")).toHaveText("Operating");
    await expectAuthorityBetween(page, 1_800, 2_000);
    expect(usd((await state(request)).cap)).toBeGreaterThan(1_800);
  });

  test("Someone else's World ID cannot renew this vault", async ({ request }) => {
    const before = (await state(request)).lastVerified;
    await worldAnswers(page, "verify-again", () => window.__world.approve("proof_of_human", "0xjudge"));
    await expect(page.getByTestId("verify-error")).toContainText("already has its human");
    await page.getByTestId("verify-cancel").click();
    expect((await state(request)).lastVerified).toBe(before);
  });

  test("Portal rejection: the proof fails server-side, no transaction", async ({ request }) => {
    const before = (await state(request)).lastVerified;
    await worldAnswers(page, "verify-again", () => window.__world.approve("selfie", "0xportal-reject"));
    await expect(page.getByTestId("verify-error")).toContainText("World rejected the proof");
    await page.getByTestId("verify-cancel").click();
    expect((await state(request)).lastVerified).toBe(before);
  });

  test("Revoke: the owner's wallet pulls the mandate, the page says so and goes close-only", async ({ request }) => {
    await page.getByTestId("revoke").click();
    await expect(page.getByTestId("status")).toHaveText("Close-only", { timeout: 60_000 });
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
    await expect(page.getByTestId("feed")).toContainText("You withdrew", { timeout: 60_000 });
    await expect(page.getByTestId("vault-balances")).toHaveText(/^0 USDC · [\d,]+ HYPE$/);
  });

  test("Restore: only the owner can bring a revoked mandate back", async ({ request }) => {
    await page.getByTestId("restore").click();
    await expect(page.getByTestId("status")).not.toHaveText("Close-only", { timeout: 60_000 });
    await expect(page.getByTestId("verify-again")).toBeVisible();
    const s = await state(request);
    expect(s.alive).toBe(true);
    expect(usd(s.cap)).toBeGreaterThan(0);
  });

  test("A visitor without a wallet sees the vault read-only", async ({ browser }) => {
    const visitor = await browser.newPage();
    await visitor.goto(`/app?vault=${vault}`);
    await expect(visitor.getByTestId("dashboard")).toBeVisible();
    await expect(visitor.getByTestId("viewer-note")).toBeVisible();
    await expect(visitor.getByTestId("revoke")).toBeHidden();
    await expect(visitor.getByTestId("deposit")).toBeHidden();
    await expect(visitor.getByTestId("verify-again")).toBeVisible();
    await visitor.screenshot({ path: shot("6-viewer") });
    await visitor.close();
  });
});
