/**
 * diff.test.ts — Unit tests for the diff engine
 */

import { computeDiff } from "../src/diff";
import { SpreadsheetData } from "../src/sheets";

function makeData(tabs: { name: string; rows: string[][] }[]): SpreadsheetData {
  return {
    spreadsheetId: "test",
    fetchedAt: new Date().toISOString(),
    tabs: tabs.map((t) => ({ name: t.name, rows: t.rows, rowCount: t.rows.length })),
    totalRows: tabs.reduce((s, t) => s + t.rows.length, 0),
  };
}

describe("computeDiff — tab changes", () => {
  it("detects added tabs", () => {
    const prev = makeData([{ name: "Sheet1", rows: [["a"]] }]);
    const curr = makeData([
      { name: "Sheet1", rows: [["a"]] },
      { name: "Sheet2", rows: [["b"]] },
    ]);
    const diff = computeDiff(prev, curr);
    expect(diff.addedTabs).toContain("Sheet2");
    expect(diff.hasChanges).toBe(true);
  });

  it("detects removed tabs", () => {
    const prev = makeData([
      { name: "Sheet1", rows: [["a"]] },
      { name: "OldTab", rows: [["x"]] },
    ]);
    const curr = makeData([{ name: "Sheet1", rows: [["a"]] }]);
    const diff = computeDiff(prev, curr);
    expect(diff.removedTabs).toContain("OldTab");
    expect(diff.hasChanges).toBe(true);
  });
});

describe("computeDiff — row changes", () => {
  it("detects added rows", () => {
    const prev = makeData([{ name: "Sheet1", rows: [["Alice", "30"]] }]);
    const curr = makeData([
      { name: "Sheet1", rows: [["Alice", "30"], ["Bob", "25"]] },
    ]);
    const diff = computeDiff(prev, curr);
    const tabDiff = diff.tabDiffs.find((t) => t.tabName === "Sheet1");
    expect(tabDiff).toBeDefined();
    expect(tabDiff!.addedRows.length).toBe(1);
    expect(tabDiff!.addedRows[0]!.row).toEqual(["Bob", "25"]);
  });

  it("detects deleted rows", () => {
    const prev = makeData([
      { name: "Sheet1", rows: [["Alice", "30"], ["Bob", "25"]] },
    ]);
    const curr = makeData([{ name: "Sheet1", rows: [["Alice", "30"]] }]);
    const diff = computeDiff(prev, curr);
    const tabDiff = diff.tabDiffs.find((t) => t.tabName === "Sheet1");
    expect(tabDiff).toBeDefined();
    expect(tabDiff!.deletedRows.length).toBe(1);
    expect(tabDiff!.deletedRows[0]!.row).toEqual(["Bob", "25"]);
  });

  it("detects modified rows", () => {
    const prev = makeData([
      { name: "Sheet1", rows: [["Alice", "30", "Mumbai"]] },
    ]);
    const curr = makeData([
      { name: "Sheet1", rows: [["Alice", "31", "Mumbai"]] }, // age changed
    ]);
    const diff = computeDiff(prev, curr);
    const tabDiff = diff.tabDiffs.find((t) => t.tabName === "Sheet1");
    expect(tabDiff).toBeDefined();
    expect(tabDiff!.modifiedRows.length).toBe(1);
    const modRow = tabDiff!.modifiedRows[0]!;
    expect(modRow.cellChanges.length).toBe(1);
    expect(modRow.cellChanges[0]!.column).toBe("B");
    expect(modRow.cellChanges[0]!.before).toBe("30");
    expect(modRow.cellChanges[0]!.after).toBe("31");
  });

  it("reports no changes when data is identical", () => {
    const data = makeData([{ name: "Sheet1", rows: [["Alice", "30"]] }]);
    const diff = computeDiff(data, data);
    expect(diff.hasChanges).toBe(false);
    expect(diff.tabDiffs.length).toBe(0);
    expect(diff.addedTabs.length).toBe(0);
    expect(diff.removedTabs.length).toBe(0);
  });

  it("handles empty tabs gracefully", () => {
    const prev = makeData([{ name: "EmptyTab", rows: [] }]);
    const curr = makeData([{ name: "EmptyTab", rows: [] }]);
    const diff = computeDiff(prev, curr);
    expect(diff.hasChanges).toBe(false);
  });

  it("handles tab transitioning from empty to populated", () => {
    const prev = makeData([{ name: "Sheet1", rows: [] }]);
    const curr = makeData([{ name: "Sheet1", rows: [["New Row", "Data"]] }]);
    const diff = computeDiff(prev, curr);
    expect(diff.hasChanges).toBe(true);
    const tabDiff = diff.tabDiffs.find((t) => t.tabName === "Sheet1");
    expect(tabDiff?.addedRows.length).toBe(1);
  });
});

describe("computeDiff — summary", () => {
  it("generates a meaningful summary string", () => {
    const prev = makeData([{ name: "Sheet1", rows: [["Alice"]] }]);
    const curr = makeData([
      { name: "Sheet1", rows: [["Alice"], ["Bob"]] },
      { name: "Sheet2", rows: [["New Tab Row"]] },
    ]);
    const diff = computeDiff(prev, curr);
    expect(diff.summary).toContain("tab");
    expect(diff.summary.length).toBeGreaterThan(5);
  });
});
