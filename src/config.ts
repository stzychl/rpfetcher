/**
 * config.ts
 *
 * Centralised configuration loader.
 * Reads .env, validates required fields, and exports a strongly-typed Config object.
 * Fail-fast on startup if critical env vars are missing.
 */

import dotenv from "dotenv";
import path from "path";

// Load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

/** Typed configuration object consumed by all modules */
export interface Config {
  /** The spreadsheet ID from the Google Sheets URL: /d/SPREADSHEET_ID/edit */
  spreadsheetId: string;

  /** Path to OAuth2 credentials.json (downloaded from Google Cloud Console) */
  credentialsPath: string;

  /** Path to saved OAuth2 token (auto-created after first login) */
  tokenPath: string;

  /** Polling interval in milliseconds (default: 5 minutes) */
  checkIntervalMs: number;

  /** Previous hash state file path */
  previousHashPath: string;

  /** Previous full data snapshot file path */
  previousDataPath: string;

  /** Directory for timestamped history snapshots */
  historyDir: string;

  /** Maximum number of history snapshots to retain */
  maxHistorySnapshots: number;

  /** Logs directory */
  logsDir: string;

  /** Winston log level */
  logLevel: string;

  /** Port for the Express dashboard */
  dashboardPort: number;

  /** Notification channel toggles */
  notify: {
    console: boolean;
    desktop: boolean;
    telegram: boolean;
  };

  /** Telegram bot configuration (optional) */
  telegram: {
    botToken: string | null;
    chatId: string | null;
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        `  → Copy .env.example to .env and set your values.`
    );
  }
  return value.trim();
}

function optionalEnv(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function boolEnv(name: string, fallback: boolean): boolean {
  const val = process.env[name];
  if (val === undefined) return fallback;
  return val.toLowerCase() === "true";
}

function intEnv(name: string, fallback: number): number {
  const val = process.env[name];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed)) return fallback;
  return parsed;
}

/**
 * Load and validate configuration.
 * Called once at startup — throws on invalid config.
 */
export function loadConfig(): Config {
  const spreadsheetId = requireEnv("SPREADSHEET_ID");

  const telegramToken = optionalEnv("TELEGRAM_BOT_TOKEN") || null;
  const telegramChatId = optionalEnv("TELEGRAM_CHAT_ID") || null;
  const notifyTelegram = boolEnv("NOTIFY_TELEGRAM", false);

  if (notifyTelegram && (!telegramToken || !telegramChatId)) {
    throw new Error(
      "NOTIFY_TELEGRAM=true but TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing."
    );
  }

  return {
    spreadsheetId,
    credentialsPath: path.resolve(process.cwd(), "credentials.json"),
    tokenPath: path.resolve(process.cwd(), "token.json"),
    checkIntervalMs: intEnv("CHECK_INTERVAL_MS", 300_000),
    previousHashPath: path.resolve(process.cwd(), "state", "previousHash.json"),
    previousDataPath: path.resolve(process.cwd(), "state", "previousData.json"),
    historyDir: path.resolve(process.cwd(), "state", "history"),
    maxHistorySnapshots: intEnv("MAX_HISTORY_SNAPSHOTS", 50),
    logsDir: path.resolve(process.cwd(), "logs"),
    logLevel: optionalEnv("LOG_LEVEL", "info"),
    dashboardPort: intEnv("DASHBOARD_PORT", 3000),
    notify: {
      console: boolEnv("NOTIFY_CONSOLE", true),
      desktop: boolEnv("NOTIFY_DESKTOP", true),
      telegram: notifyTelegram,
    },
    telegram: {
      botToken: telegramToken,
      chatId: telegramChatId,
    },
  };
}

// Singleton — exported for all modules to import
export const config = loadConfig();
