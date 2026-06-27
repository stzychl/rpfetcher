/**
 * hash.ts
 *
 * SHA256 hashing for change detection.
 *
 * Creates a deterministic hash of the full spreadsheet snapshot.
 * By comparing hashes between polls we can quickly detect any change
 * without expensive deep-diffing on every run.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { SpreadsheetData } from "./sheets";
import { logger } from "./logger";

/**
 * Computes a SHA256 hash of the full spreadsheet data.
 * The data is serialised to JSON with sorted keys for determinism.
 */
export function computeHash(data: SpreadsheetData): string {
  // Serialise with consistent key order so identical data → identical hash
  const json = JSON.stringify(data, sortedReplacer);
  return crypto.createHash("sha256").update(json).digest("hex");
}

/**
 * JSON replacer that sorts object keys alphabetically.
 * Ensures hash stability regardless of property insertion order.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((sorted, k) => {
        sorted[k] = (value as Record<string, unknown>)[k];
        return sorted;
      }, {});
  }
  return value;
}

/**
 * Loads the previously stored hash from disk.
 * Returns null if no previous hash exists (first run).
 */
export function loadPreviousHash(hashPath: string): string | null {
  try {
    if (!fs.existsSync(hashPath)) return null;
    const content = fs.readFileSync(hashPath, "utf-8").trim();
    const parsed = JSON.parse(content) as { hash: string };
    return parsed.hash ?? null;
  } catch {
    logger.warn("[hash] Could not read previous hash file — treating as first run.");
    return null;
  }
}

/**
 * Saves the current hash to disk for the next comparison.
 */
export function savePreviousHash(hashPath: string, hash: string): void {
  const dir = path.dirname(hashPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    hashPath,
    JSON.stringify({ hash, savedAt: new Date().toISOString() }, null, 2)
  );
}
