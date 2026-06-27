/**
 * logger.ts
 *
 * Winston-based structured logger.
 * - Console transport with colours
 * - Rotating file transport for app.log (all levels)
 * - Rotating file transport for errors.log (errors only)
 *
 * Usage:
 *   import { logger } from './logger';
 *   logger.info('Startup complete');
 *   logger.error('Something went wrong', { err });
 */

import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";
import fs from "fs";

const logsDir = path.resolve(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const logLevel = process.env["LOG_LEVEL"] ?? "info";

/** Timestamp + level + message format for files */
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

/** Colourised format for the console */
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: "HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const extras =
      Object.keys(meta).length > 0 ? `  ${JSON.stringify(meta)}` : "";
    return `[${timestamp as string}] ${level}: ${message as string}${extras}`;
  })
);

const transports: winston.transport[] = [
  // Colourised console output
  new winston.transports.Console({ format: consoleFormat }),

  // Rolling app log — all levels
  new DailyRotateFile({
    filename: path.join(logsDir, "app-%DATE%.log"),
    datePattern: "YYYY-MM-DD",
    zippedArchive: true,
    maxSize: "20m",
    maxFiles: "14d",
    level: logLevel,
    format: fileFormat,
  }),

  // Rolling error log — errors only
  new DailyRotateFile({
    filename: path.join(logsDir, "errors-%DATE%.log"),
    datePattern: "YYYY-MM-DD",
    zippedArchive: true,
    maxSize: "20m",
    maxFiles: "30d",
    level: "error",
    format: fileFormat,
  }),
];

export const logger = winston.createLogger({
  level: logLevel,
  transports,
  // Prevent Winston from throwing on uncaught exceptions itself —
  // we handle those in index.ts
  exitOnError: false,
});
