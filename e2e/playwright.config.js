import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./setup.js",
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:8788", viewport: { width: 1280, height: 900 }, screenshot: "only-on-failure", trace: "retain-on-failure" },
});
