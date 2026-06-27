/**
 * scheduler.ts
 *
 * Polling scheduler with overlap prevention.
 *
 * Features:
 *  - Runs a check function at a configurable interval
 *  - Prevents overlapping executions using a lock flag
 *  - Logs each cycle and its outcome
 *  - Recovers gracefully after errors (doesn't die on a failed check)
 *  - Emits events consumed by the web dashboard
 */

import { EventEmitter } from "events";
import { logger } from "./logger";

export interface SchedulerOptions {
  /** Interval between checks in milliseconds */
  intervalMs: number;
  /** The async function to run on each tick */
  checkFn: () => Promise<void>;
  /** Optional name for logging */
  name?: string;
}

export interface SchedulerStatus {
  isRunning: boolean;
  lastCheckAt: string | null;
  nextCheckAt: string | null;
  totalChecks: number;
  totalErrors: number;
  lastError: string | null;
}

/**
 * A non-overlapping scheduler that emits events for monitoring.
 */
export class Scheduler extends EventEmitter {
  private readonly options: Required<SchedulerOptions>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private locked = false;
  private status: SchedulerStatus = {
    isRunning: false,
    lastCheckAt: null,
    nextCheckAt: null,
    totalChecks: 0,
    totalErrors: 0,
    lastError: null,
  };

  constructor(options: SchedulerOptions) {
    super();
    this.options = { name: "Scheduler", ...options };
  }

  /** Returns a copy of the current scheduler status */
  getStatus(): SchedulerStatus {
    return { ...this.status };
  }

  /** Starts the polling loop. Runs the first check immediately. */
  start(): void {
    if (this.timer !== null) {
      logger.warn(`[${this.options.name}] Already running.`);
      return;
    }

    logger.info(
      `[${this.options.name}] Starting. Interval: ${this.options.intervalMs / 1000}s`
    );
    this.status.isRunning = true;

    // Run immediately on start
    void this.runCheck();

    this.timer = setInterval(() => {
      void this.runCheck();
    }, this.options.intervalMs);

    this.updateNextCheckAt();
  }

  /** Stops the polling loop. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.status.isRunning = false;
    this.status.nextCheckAt = null;
    logger.info(`[${this.options.name}] Stopped.`);
    this.emit("stopped");
  }

  /** Executes a single check with overlap prevention. */
  private async runCheck(): Promise<void> {
    if (this.locked) {
      logger.warn(
        `[${this.options.name}] Previous check still running — skipping this tick.`
      );
      return;
    }

    this.locked = true;
    const startTime = Date.now();
    this.emit("checkStart");

    try {
      await this.options.checkFn();
      const duration = Date.now() - startTime;

      this.status.lastCheckAt = new Date().toISOString();
      this.status.totalChecks++;
      this.updateNextCheckAt();

      logger.info(
        `[${this.options.name}] Check completed in ${duration}ms. Total: ${this.status.totalChecks}`
      );
      this.emit("checkComplete", { duration });
    } catch (err) {
      const error = err as Error;
      this.status.totalErrors++;
      this.status.lastError = error.message;
      this.updateNextCheckAt();

      logger.error(`[${this.options.name}] Check failed.`, {
        error: error.message,
        stack: error.stack,
      });
      this.emit("checkError", { error });
    } finally {
      this.locked = false;
    }
  }

  private updateNextCheckAt(): void {
    this.status.nextCheckAt = new Date(
      Date.now() + this.options.intervalMs
    ).toISOString();
  }
}
