/**
 * notifier.ts
 *
 * Multi-channel notification dispatcher.
 *
 * Supported channels:
 *  1. Console — chalk-coloured terminal output
 *  2. Desktop — OS toast notifications via node-notifier
 *  3. Telegram — Bot API messages (optional)
 *
 * Each channel is independently toggled via config.
 */

import chalk from "chalk";
import notifier from "node-notifier";
import TelegramBot from "node-telegram-bot-api";
import { DiffResult, TabDiff } from "./diff";
import { Config } from "./config";
import { logger } from "./logger";

// -------------------------------------------------------------------
// Telegram bot singleton
// -------------------------------------------------------------------

let telegramBot: TelegramBot | null = null;

function getTelegramBot(config: Config): TelegramBot | null {
  if (!config.notify.telegram || !config.telegram.botToken) return null;
  if (!telegramBot) {
    telegramBot = new TelegramBot(config.telegram.botToken, { polling: false });
  }
  return telegramBot;
}

// -------------------------------------------------------------------
// Formatters
// -------------------------------------------------------------------

/**
 * Formats a DiffResult into a structured Telegram message (Markdown).
 */
function formatTelegramMessage(diff: DiffResult, spreadsheetId: string): string {
  const ts = new Date(diff.detectedAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium",
  });

  const lines: string[] = [
    `🔔 *Spreadsheet Change Detected*`,
    `📅 ${ts}`,
    `📊 [Open Spreadsheet](https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit)`,
    ``,
    `*Summary:* ${escapeMarkdown(diff.summary)}`,
    ``,
  ];

  if (diff.addedTabs.length > 0) {
    lines.push(`➕ *New Tabs:* ${diff.addedTabs.map((t) => `\`${t}\``).join(", ")}`);
  }
  if (diff.removedTabs.length > 0) {
    lines.push(`➖ *Removed Tabs:* ${diff.removedTabs.map((t) => `\`${t}\``).join(", ")}`);
  }

  diff.tabDiffs.slice(0, 5).forEach((td: TabDiff) => {
    lines.push(`\n📋 *Tab: ${escapeMarkdown(td.tabName)}*`);
    if (td.addedRows.length > 0) lines.push(`  \\+ Added rows: ${td.addedRows.length}`);
    if (td.deletedRows.length > 0) lines.push(`  \\- Deleted rows: ${td.deletedRows.length}`);
    if (td.modifiedRows.length > 0) lines.push(`  ✏️ Modified rows: ${td.modifiedRows.length}`);
  });

  if (diff.tabDiffs.length > 5) {
    lines.push(`\n_...and ${diff.tabDiffs.length - 5} more tabs with changes_`);
  }

  return lines.join("\n");
}

/** Escapes special Telegram MarkdownV2 characters */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, "\\$&");
}

/**
 * Formats a DiffResult for colourised console output.
 */
function formatConsoleOutput(diff: DiffResult): string {
  const lines: string[] = [
    chalk.bold.yellow("━".repeat(60)),
    chalk.bold.yellow("🔔  SPREADSHEET CHANGE DETECTED"),
    chalk.dim(`   at ${diff.detectedAt}`),
    chalk.yellow("━".repeat(60)),
    `   ${chalk.white.bold("Summary:")} ${diff.summary}`,
  ];

  if (diff.addedTabs.length > 0) {
    lines.push(`\n   ${chalk.green("➕ New Tabs:")} ${diff.addedTabs.join(", ")}`);
  }
  if (diff.removedTabs.length > 0) {
    lines.push(`   ${chalk.red("➖ Removed Tabs:")} ${diff.removedTabs.join(", ")}`);
  }

  diff.tabDiffs.forEach((td) => {
    lines.push(`\n   ${chalk.cyan("📋 Tab:")} ${chalk.cyan.bold(td.tabName)}`);
    td.addedRows.forEach(({ rowIndex, row }) => {
      lines.push(`      ${chalk.green("+")} Row ${rowIndex + 1}: ${chalk.green(row.slice(0, 4).join(" | "))}`);
    });
    td.deletedRows.forEach(({ rowIndex, row }) => {
      lines.push(`      ${chalk.red("−")} Row ${rowIndex + 1}: ${chalk.red(row.slice(0, 4).join(" | "))}`);
    });
    td.modifiedRows.forEach(({ rowIndex, cellChanges }) => {
      lines.push(`      ${chalk.yellow("~")} Row ${rowIndex + 1}: ${cellChanges.length} cell(s) changed`);
      cellChanges.forEach(({ column, before, after }) => {
        lines.push(
          `        Col ${column}: ${chalk.red(before)} → ${chalk.green(after)}`
        );
      });
    });
  });

  lines.push(chalk.bold.yellow("━".repeat(60)));
  return lines.join("\n");
}

// -------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------

export interface NotifyOptions {
  diff: DiffResult;
  spreadsheetId: string;
}

/**
 * Dispatches notifications to all enabled channels.
 */
export async function notifyChanges(
  options: NotifyOptions,
  config: Config
): Promise<void> {
  const { diff, spreadsheetId } = options;

  // 1. Console notification
  if (config.notify.console) {
    console.log(formatConsoleOutput(diff));
  }

  // 2. Desktop notification
  if (config.notify.desktop) {
    try {
      notifier.notify({
        title: "📊 Spreadsheet Changed",
        message: diff.summary.slice(0, 256),
        sound: true,
        wait: false,
      });
    } catch (err) {
      logger.warn("[notifier] Desktop notification failed.", {
        error: (err as Error).message,
      });
    }
  }

  // 3. Telegram notification
  if (config.notify.telegram) {
    const bot = getTelegramBot(config);
    const chatId = config.telegram.chatId;

    if (bot && chatId) {
      try {
        const message = formatTelegramMessage(diff, spreadsheetId);
        await bot.sendMessage(chatId, message, {
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true,
        });
        logger.debug("[notifier] Telegram notification sent.");
      } catch (err) {
        logger.error("[notifier] Telegram notification failed.", {
          error: (err as Error).message,
        });
      }
    }
  }
}

/**
 * Sends a startup message to Telegram if configured.
 */
export async function notifyStartup(config: Config): Promise<void> {
  if (!config.notify.telegram) return;
  const bot = getTelegramBot(config);
  const chatId = config.telegram.chatId;
  if (!bot || !chatId) return;

  try {
    const ts = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    await bot.sendMessage(
      chatId,
      `🟢 *Spreadsheet Monitor Started*\n📅 ${escapeMarkdown(ts)}\n🔁 Polling every ${Math.round(config.checkIntervalMs / 1000)}s`,
      { parse_mode: "MarkdownV2" }
    );
  } catch (err) {
    logger.warn("[notifier] Startup Telegram notification failed.", {
      error: (err as Error).message,
    });
  }
}
