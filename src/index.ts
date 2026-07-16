/**
 * index.ts
 *
 * Application entry point.
 *
 * Bootstraps:
 *  1. Configuration validation
 *  2. OAuth2 authentication
 *  3. Web dashboard
 *  4. Polling scheduler
 *  5. Graceful shutdown handlers
 */

import chalk from "chalk";
import { config } from "./config";
import { logger } from "./logger";
import { getAuthClient } from "./auth";
import { fetchAllData } from "./sheets";
import { Auth } from "googleapis";
import { computeHash, loadPreviousHash, savePreviousHash } from "./hash";
import {
  computeDiff,
  loadPreviousData,
  savePreviousData,
  exportDiffToJson,
  exportMarkdownReport,
  pruneHistory,
} from "./diff";
import { notifyChanges, notifyStartup } from "./notifier";
import { Scheduler } from "./scheduler";
import {
  dashboardState,
  recordChange,
  startDashboard,
} from "./dashboard";

// -------------------------------------------------------------------
// Banner
// -------------------------------------------------------------------

function printBanner(): void {
  console.log(
    chalk.bold.cyan(`
╔═══════════════════════════════════════════════════════╗
║          📊  Spreadsheet Monitor  v1.0.0             ║
║          Google Sheets API v4  (OAuth2)               ║
╚═══════════════════════════════════════════════════════╝
`)
  );
  console.log(chalk.dim(`  Spreadsheet ID : ${config.spreadsheetId}`));
  console.log(chalk.dim(`  Interval       : ${config.checkIntervalMs / 1000}s`));
  console.log(chalk.dim(`  Dashboard      : http://localhost:${config.dashboardPort}`));
  console.log(chalk.dim(`  Notifications  : console=${config.notify.console} desktop=${config.notify.desktop} telegram=${config.notify.telegram}`));
  console.log();
}

// -------------------------------------------------------------------
// Core check function (runs on each scheduler tick)
// -------------------------------------------------------------------

// Authenticated OAuth2 client — set once at startup
let authClient: Auth.OAuth2Client;

async function performCheck(): Promise<void> {
  // 1. Fetch current spreadsheet data via Sheets API
  const currentData = await fetchAllData(authClient, config.spreadsheetId);

  // 2. Update dashboard state
  dashboardState.currentData = currentData;
  dashboardState.spreadsheetId = config.spreadsheetId;

  // 3. Compute hash and compare
  const currentHash = computeHash(currentData);
  const previousHash = loadPreviousHash(config.previousHashPath);

  if (previousHash === currentHash) {
    logger.info("[check] No changes detected (hash match).");
    return;
  }

  // 4. Hash changed — compute detailed diff
  logger.info("[check] Hash changed — computing detailed diff...");
  const previousData = loadPreviousData(config.previousDataPath);

  let diff = null;
  if (previousData) {
    diff = computeDiff(previousData, currentData);
    logger.info(`[check] Diff complete. ${diff.summary}`);
  } else {
    logger.info("[check] First run — no previous data to diff against.");
  }

  // 5. Save new state
  savePreviousHash(config.previousHashPath, currentHash);
  savePreviousData(config.previousDataPath, currentData);

  if (!diff) return; // First run: nothing to notify about

  // 6. Record change in dashboard
  recordChange(diff);

  // 7. Export diff and markdown report if there are changes
  if (diff.hasChanges) {
    const jsonPath = exportDiffToJson(config.historyDir, diff);
    const mdPath = exportMarkdownReport(config.historyDir, diff);
    logger.info(`[check] Diff exported: ${jsonPath}`);
    logger.info(`[check] Report exported: ${mdPath}`);

    // Prune old history files
    pruneHistory(config.historyDir, config.maxHistorySnapshots);

    // 8. Send notifications
    await notifyChanges(
      { diff, spreadsheetId: config.spreadsheetId },
      config
    );
  }
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

async function main(): Promise<void> {
  printBanner();
  logger.info("Spreadsheet Monitor starting up...");

  // Authenticate via OAuth2 (opens browser on first run, reuses token.json after)
  logger.info("Authenticating with Google...");
  authClient = await getAuthClient();
  logger.info("✅ Google authentication successful.");

  // Start optional Telegram startup notification
  await notifyStartup(config);

  // Start web dashboard
  startDashboard(config.dashboardPort);

  // Create scheduler
  const scheduler = new Scheduler({
    intervalMs: config.checkIntervalMs,
    checkFn: performCheck,
    name: "SpreadsheetMonitor",
  });

  // Wire scheduler status into dashboard state
  scheduler.on("checkComplete", () => {
    dashboardState.scheduler = scheduler.getStatus();
  });
  scheduler.on("checkError", () => {
    dashboardState.scheduler = scheduler.getStatus();
  });

  scheduler.start();
  dashboardState.scheduler = scheduler.getStatus();

  // -------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------

  const shutdown = (signal: string) => {
    logger.info(`Received ${signal} — shutting down gracefully...`);
    scheduler.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Catch uncaught exceptions so the process doesn't die silently
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception:", { error: err.message, stack: err.stack });
    // Don't exit — the scheduler will continue on next tick
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection:", { reason });
  });

  logger.info(
    chalk.green(`✅ Monitor is running. Dashboard: http://localhost:${config.dashboardPort}`)
  );
}

// Run
main().catch((err) => {
  logger.error("Fatal startup error:", { error: (err as Error).message });
  console.error(chalk.red(`\n❌ Fatal Error: ${(err as Error).message}\n`));
  process.exit(1);
});
