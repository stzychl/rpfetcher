/**
 * config.test.ts — Unit tests for the config loader
 */

import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clone the env so we can safely mutate it
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws if SPREADSHEET_ID is missing", () => {
    delete process.env["SPREADSHEET_ID"];
    expect(() => loadConfig()).toThrow("SPREADSHEET_ID");
  });

  it("loads valid config with defaults", () => {
    process.env["SPREADSHEET_ID"] = "abc123";
    const cfg = loadConfig();
    expect(cfg.spreadsheetId).toBe("abc123");
    expect(cfg.checkIntervalMs).toBe(300_000); // default
    expect(cfg.dashboardPort).toBe(3000); // default
    expect(cfg.notify.console).toBe(true); // default
    expect(cfg.notify.telegram).toBe(false); // default
  });

  it("respects custom CHECK_INTERVAL_MS", () => {
    process.env["SPREADSHEET_ID"] = "abc";
    process.env["CHECK_INTERVAL_MS"] = "60000";
    const cfg = loadConfig();
    expect(cfg.checkIntervalMs).toBe(60_000);
  });

  it("enables telegram when all telegram fields provided", () => {
    process.env["SPREADSHEET_ID"] = "abc";
    process.env["NOTIFY_TELEGRAM"] = "true";
    process.env["TELEGRAM_BOT_TOKEN"] = "token123";
    process.env["TELEGRAM_CHAT_ID"] = "chat456";
    const cfg = loadConfig();
    expect(cfg.notify.telegram).toBe(true);
    expect(cfg.telegram.botToken).toBe("token123");
    expect(cfg.telegram.chatId).toBe("chat456");
  });

  it("throws if telegram enabled but token missing", () => {
    process.env["SPREADSHEET_ID"] = "abc";
    process.env["NOTIFY_TELEGRAM"] = "true";
    delete process.env["TELEGRAM_BOT_TOKEN"];
    delete process.env["TELEGRAM_CHAT_ID"];
    expect(() => loadConfig()).toThrow("TELEGRAM_BOT_TOKEN");
  });
});
