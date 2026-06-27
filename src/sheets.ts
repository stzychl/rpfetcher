/**
 * sheets.ts
 *
 * Fetches spreadsheet data via the Google Sheets API v4.
 *
 * Requires an authenticated OAuth2 client (read-only scope is sufficient).
 * Works with any spreadsheet you have at least viewer access to.
 */

import { google, Auth } from "googleapis";
import { logger } from "./logger";

/** A single cell value — normalised to string */
export type CellValue = string;

/** A row of cell values */
export type Row = CellValue[];

/** Data for a single tab */
export interface TabData {
  /** The visible tab name */
  name: string;
  /** All rows in the tab (array of row arrays) */
  rows: Row[];
  /** Total non-empty row count */
  rowCount: number;
}

/** Full spreadsheet snapshot */
export interface SpreadsheetData {
  /** The spreadsheet ID */
  spreadsheetId: string;
  /** When this snapshot was taken */
  fetchedAt: string;
  /** All tabs */
  tabs: TabData[];
  /** Total row count across all tabs */
  totalRows: number;
}

/** Retry configuration */
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async operation with exponential backoff retry logic.
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  context: string
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err as Error;

      if (attempt === MAX_RETRIES) {
        logger.error(`[sheets] ${context} failed permanently.`, {
          attempt,
          error: lastError.message,
        });
        throw lastError;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      logger.warn(
        `[sheets] ${context} failed (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${delay}ms...`,
        { error: lastError.message }
      );
      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Normalises a cell value from the Sheets API to a plain string.
 * The API returns cells as objects with a .formattedValue field,
 * or undefined for empty cells.
 */
function cellToString(cell: { formattedValue?: string } | null | undefined): string {
  return cell?.formattedValue ?? "";
}

/**
 * Fetches all sheets and their data from the spreadsheet using the Sheets API v4.
 * This is the main function called by index.ts on each scheduler tick.
 *
 * @param auth      - Authenticated OAuth2 client
 * @param spreadsheetId - The spreadsheet ID (from the URL: /d/SPREADSHEET_ID/edit)
 */
export async function fetchAllData(
  auth: Auth.OAuth2Client,
  spreadsheetId: string
): Promise<SpreadsheetData> {
  const sheets = google.sheets({ version: "v4", auth });

  // Step 1: Get spreadsheet metadata (sheet names)
  const meta = await withRetry(
    () => sheets.spreadsheets.get({ spreadsheetId }),
    "spreadsheets.get"
  );

  const sheetMetas = meta.data.sheets ?? [];
  if (sheetMetas.length === 0) {
    logger.warn("[sheets] Spreadsheet has no sheets.");
    return {
      spreadsheetId,
      fetchedAt: new Date().toISOString(),
      tabs: [],
      totalRows: 0,
    };
  }

  // Step 2: Batch-fetch all sheets in one API call
  const ranges = sheetMetas.map((s) => s.properties?.title ?? "Sheet1");

  logger.debug(`[sheets] Fetching ${ranges.length} sheet(s): ${ranges.join(", ")}`);

  const batchResult = await withRetry(
    () =>
      sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
        valueRenderOption: "FORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING",
      }),
    "spreadsheets.values.batchGet"
  );

  const valueRanges = batchResult.data.valueRanges ?? [];

  // Step 3: Build TabData array
  const tabs: TabData[] = valueRanges.map((vr, idx) => {
    const name = ranges[idx];
    const rawRows: string[][] = (vr.values ?? []) as string[][];

    // Normalise: ensure every cell is a string
    const rows: Row[] = rawRows.map((row) =>
      row.map((cell) => (cell == null ? "" : String(cell)))
    );

    // Drop trailing fully-empty rows
    while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) {
      rows.pop();
    }

    return {
      name,
      rows,
      rowCount: rows.length,
    };
  });

  const totalRows = tabs.reduce((sum, t) => sum + t.rowCount, 0);

  logger.info(
    `[sheets] Fetched ${tabs.length} tab(s), ${totalRows} total rows via Sheets API.`
  );

  return {
    spreadsheetId,
    fetchedAt: new Date().toISOString(),
    tabs,
    totalRows,
  };
}
