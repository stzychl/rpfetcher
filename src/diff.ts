/**
 * diff.ts
 *
 * Change detection engine.
 *
 * Compares two SpreadsheetData snapshots and produces a detailed DiffResult:
 *  - Added / removed tabs
 *  - Added / deleted / modified rows per tab
 *  - Exact cell changes within modified rows
 *
 * Also writes:
 *  - JSON diff export to state/history/
 *  - Markdown change report to state/history/
 */

import fs from "fs";
import path from "path";
import { SpreadsheetData, Row } from "./sheets";
import { logger } from "./logger";

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

/** A single cell that changed */
export interface CellChange {
  columnIndex: number;
  /** Column letter (A, B, C, ...) */
  column: string;
  before: string;
  after: string;
}

/** A row that was modified */
export interface ModifiedRow {
  rowIndex: number;
  before: Row;
  after: Row;
  cellChanges: CellChange[];
}

/** Changes within a single tab */
export interface TabDiff {
  tabName: string;
  addedRows: { rowIndex: number; row: Row }[];
  deletedRows: { rowIndex: number; row: Row }[];
  modifiedRows: ModifiedRow[];
}

/** The top-level diff result */
export interface DiffResult {
  hasChanges: boolean;
  detectedAt: string;
  addedTabs: string[];
  removedTabs: string[];
  tabDiffs: TabDiff[];
  summary: string;
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

/**
 * Converts a zero-based column index to a spreadsheet column letter.
 * 0 → A, 25 → Z, 26 → AA, etc.
 */
function columnIndexToLetter(index: number): string {
  let letter = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/**
 * Compares two rows cell-by-cell and returns an array of changed cells.
 */
function diffRows(before: Row, after: Row): CellChange[] {
  const maxLen = Math.max(before.length, after.length);
  const changes: CellChange[] = [];

  for (let col = 0; col < maxLen; col++) {
    const b = before[col] ?? "";
    const a = after[col] ?? "";
    if (b !== a) {
      changes.push({
        columnIndex: col,
        column: columnIndexToLetter(col),
        before: b,
        after: a,
      });
    }
  }
  return changes;
}

/**
 * Serialises a row to a comparable string key.
 * Used to identify rows across snapshots even if their index shifts.
 */
function rowKey(row: Row): string {
  return row.join("\x00");
}

// -------------------------------------------------------------------
// Core diff logic
// -------------------------------------------------------------------

/**
 * Compares a single tab's before/after row sets.
 *
 * Strategy: uses the first column as a loose "primary key" hint,
 * but falls back to positional diffing when rows lack unique first-column values.
 */
function diffTab(tabName: string, before: Row[], after: Row[]): TabDiff {
  const addedRows: TabDiff["addedRows"] = [];
  const deletedRows: TabDiff["deletedRows"] = [];
  const modifiedRows: ModifiedRow[] = [];

  const maxLen = Math.max(before.length, after.length);

  // --- Simple positional diff ---
  // For large datasets this is O(n) which is efficient.
  // A full LCS would be O(n²) and impractical for thousands of rows.
  const beforeSet = new Map<string, number>(); // key → rowIndex
  before.forEach((row, i) => beforeSet.set(rowKey(row), i));
  const afterSet = new Map<string, number>();
  after.forEach((row, i) => afterSet.set(rowKey(row), i));

  // Detect deletions: rows in before but not in after
  before.forEach((row, i) => {
    if (!afterSet.has(rowKey(row))) {
      deletedRows.push({ rowIndex: i, row });
    }
  });

  // Detect additions: rows in after but not in before
  after.forEach((row, i) => {
    if (!beforeSet.has(rowKey(row))) {
      addedRows.push({ rowIndex: i, row });
    }
  });

  // Detect modifications: same row index, different content
  // (for positional diffing when rows aren't in the change sets above)
  for (let i = 0; i < maxLen; i++) {
    const b = before[i];
    const a = after[i];
    if (!b || !a) continue; // handled as add/delete above

    // If both exist at index i and both are "unchanged by key" but content differs...
    if (b !== a && rowKey(b) !== rowKey(a)) {
      // Only mark as modified if neither was classified as add/delete
      const bDeleted = deletedRows.some((d) => d.rowIndex === i);
      const aAdded = addedRows.some((ad) => ad.rowIndex === i);

      if (!bDeleted && !aAdded) {
        const cellChanges = diffRows(b, a);
        if (cellChanges.length > 0) {
          modifiedRows.push({ rowIndex: i, before: b, after: a, cellChanges });
        }
      }
    }
  }

  // Suppress maxLen if not used in the actual loop (TypeScript noUnusedLocals)
  void maxLen;

  return { tabName, addedRows, deletedRows, modifiedRows };
}

// -------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------

/**
 * Computes a full diff between two SpreadsheetData snapshots.
 */
export function computeDiff(
  previous: SpreadsheetData,
  current: SpreadsheetData
): DiffResult {
  const detectedAt = new Date().toISOString();

  const prevTabNames = new Set(previous.tabs.map((t) => t.name));
  const currTabNames = new Set(current.tabs.map((t) => t.name));

  const addedTabs = [...currTabNames].filter((n) => !prevTabNames.has(n));
  const removedTabs = [...prevTabNames].filter((n) => !currTabNames.has(n));

  const tabDiffs: TabDiff[] = [];

  // Diff tabs that exist in both snapshots
  for (const currTab of current.tabs) {
    const prevTab = previous.tabs.find((t) => t.name === currTab.name);
    if (!prevTab) continue; // newly added tab — not a modification

    const tabDiff = diffTab(currTab.name, prevTab.rows, currTab.rows);

    // Only include if there are actual changes
    const hasChanges =
      tabDiff.addedRows.length > 0 ||
      tabDiff.deletedRows.length > 0 ||
      tabDiff.modifiedRows.length > 0;

    if (hasChanges) {
      tabDiffs.push(tabDiff);
    }
  }

  const hasChanges =
    addedTabs.length > 0 ||
    removedTabs.length > 0 ||
    tabDiffs.length > 0;

  // Build a human-readable summary
  const parts: string[] = [];
  if (addedTabs.length > 0) parts.push(`${addedTabs.length} tab(s) added`);
  if (removedTabs.length > 0) parts.push(`${removedTabs.length} tab(s) removed`);
  tabDiffs.forEach((td) => {
    const tabParts: string[] = [];
    if (td.addedRows.length > 0) tabParts.push(`+${td.addedRows.length} rows`);
    if (td.deletedRows.length > 0) tabParts.push(`-${td.deletedRows.length} rows`);
    if (td.modifiedRows.length > 0) tabParts.push(`~${td.modifiedRows.length} modified`);
    if (tabParts.length > 0) parts.push(`[${td.tabName}]: ${tabParts.join(", ")}`);
  });

  const summary = hasChanges ? parts.join(" | ") : "No changes detected.";

  return {
    hasChanges,
    detectedAt,
    addedTabs,
    removedTabs,
    tabDiffs,
    summary,
  };
}

// -------------------------------------------------------------------
// State persistence
// -------------------------------------------------------------------

/**
 * Loads the previous SpreadsheetData snapshot from disk.
 * Returns null on first run.
 */
export function loadPreviousData(dataPath: string): SpreadsheetData | null {
  try {
    if (!fs.existsSync(dataPath)) return null;
    const raw = fs.readFileSync(dataPath, "utf-8");
    return JSON.parse(raw) as SpreadsheetData;
  } catch {
    logger.warn("[diff] Could not read previous data file — treating as first run.");
    return null;
  }
}

/**
 * Saves the current SpreadsheetData snapshot to disk.
 */
export function savePreviousData(dataPath: string, data: SpreadsheetData): void {
  const dir = path.dirname(dataPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

// -------------------------------------------------------------------
// History exports
// -------------------------------------------------------------------

/**
 * Exports a diff result to a timestamped JSON file in the history directory.
 */
export function exportDiffToJson(historyDir: string, diff: DiffResult): string {
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(historyDir, `diff-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(diff, null, 2));
  logger.debug(`[diff] Exported diff JSON to ${filePath}`);
  return filePath;
}

/**
 * Generates a Markdown change report.
 */
export function generateMarkdownReport(diff: DiffResult): string {
  const lines: string[] = [
    `# Spreadsheet Change Report`,
    ``,
    `**Detected at:** ${diff.detectedAt}`,
    `**Summary:** ${diff.summary}`,
    ``,
  ];

  if (diff.addedTabs.length > 0) {
    lines.push(`## ➕ New Tabs Added`);
    diff.addedTabs.forEach((t) => lines.push(`- \`${t}\``));
    lines.push(``);
  }

  if (diff.removedTabs.length > 0) {
    lines.push(`## ➖ Tabs Removed`);
    diff.removedTabs.forEach((t) => lines.push(`- \`${t}\``));
    lines.push(``);
  }

  diff.tabDiffs.forEach((td) => {
    lines.push(`## 📋 Tab: \`${td.tabName}\``);

    if (td.addedRows.length > 0) {
      lines.push(`### ➕ Added Rows (${td.addedRows.length})`);
      td.addedRows.forEach(({ rowIndex, row }) => {
        lines.push(`- Row ${rowIndex + 1}: \`${row.join(" | ")}\``);
      });
      lines.push(``);
    }

    if (td.deletedRows.length > 0) {
      lines.push(`### ➖ Deleted Rows (${td.deletedRows.length})`);
      td.deletedRows.forEach(({ rowIndex, row }) => {
        lines.push(`- Row ${rowIndex + 1}: \`${row.join(" | ")}\``);
      });
      lines.push(``);
    }

    if (td.modifiedRows.length > 0) {
      lines.push(`### ✏️ Modified Rows (${td.modifiedRows.length})`);
      td.modifiedRows.forEach(({ rowIndex, cellChanges }) => {
        lines.push(`- **Row ${rowIndex + 1}** — ${cellChanges.length} cell(s) changed:`);
        cellChanges.forEach(({ column, before, after }) => {
          lines.push(`  - Column **${column}**: \`${before}\` → \`${after}\``);
        });
      });
      lines.push(``);
    }
  });

  return lines.join("\n");
}

/**
 * Saves a Markdown report to the history directory.
 */
export function exportMarkdownReport(historyDir: string, diff: DiffResult): string {
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(historyDir, `report-${timestamp}.md`);
  const markdown = generateMarkdownReport(diff);
  fs.writeFileSync(filePath, markdown);
  logger.debug(`[diff] Exported markdown report to ${filePath}`);
  return filePath;
}

/**
 * Prunes old history files so we don't accumulate infinitely.
 * Keeps the most recent `maxSnapshots` pairs of (diff.json + report.md).
 */
export function pruneHistory(historyDir: string, maxSnapshots: number): void {
  if (!fs.existsSync(historyDir)) return;

  const files = fs
    .readdirSync(historyDir)
    .filter((f) => f.startsWith("diff-") || f.startsWith("report-"))
    .sort()
    .reverse();

  // Each snapshot produces 2 files; keep 2 × maxSnapshots
  const toDelete = files.slice(maxSnapshots * 2);
  toDelete.forEach((f) => {
    try {
      fs.unlinkSync(path.join(historyDir, f));
    } catch {
      // Non-fatal
    }
  });

  if (toDelete.length > 0) {
    logger.debug(`[diff] Pruned ${toDelete.length} old history file(s).`);
  }
}
