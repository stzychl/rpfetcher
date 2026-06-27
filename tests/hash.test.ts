/**
 * hash.test.ts — Unit tests for the hash module
 */

import { computeHash } from "../src/hash";
import { SpreadsheetData } from "../src/sheets";

const sampleData: SpreadsheetData = {
  spreadsheetId: "test-id-123",
  fetchedAt: "2024-01-01T00:00:00.000Z",
  tabs: [
    {
      name: "Sheet1",
      rows: [
        ["Name", "Age", "City"],
        ["Alice", "30", "Mumbai"],
        ["Bob", "25", "Delhi"],
      ],
      rowCount: 3,
    },
  ],
  totalRows: 3,
};

describe("computeHash", () => {
  it("should return a 64-character hex string (SHA256)", () => {
    const hash = computeHash(sampleData);
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it("should return the same hash for identical data", () => {
    const hash1 = computeHash(sampleData);
    const hash2 = computeHash({ ...sampleData });
    expect(hash1).toBe(hash2);
  });

  it("should return a different hash when data changes", () => {
    const hash1 = computeHash(sampleData);
    const modified: SpreadsheetData = {
      ...sampleData,
      tabs: [
        {
          ...sampleData.tabs[0]!,
          rows: [
            ...sampleData.tabs[0]!.rows,
            ["Charlie", "35", "Bangalore"],
          ],
          rowCount: 4,
        },
      ],
      totalRows: 4,
    };
    const hash2 = computeHash(modified);
    expect(hash1).not.toBe(hash2);
  });

  it("should produce consistent hash regardless of property insertion order", () => {
    const a: SpreadsheetData = {
      spreadsheetId: "abc",
      fetchedAt: "2024-01-01T00:00:00.000Z",
      tabs: [],
      totalRows: 0,
    };
    // Same data, different property order
    const b = {
      totalRows: 0,
      tabs: [],
      fetchedAt: "2024-01-01T00:00:00.000Z",
      spreadsheetId: "abc",
    } as SpreadsheetData;

    expect(computeHash(a)).toBe(computeHash(b));
  });

  it("should handle empty spreadsheet", () => {
    const empty: SpreadsheetData = {
      spreadsheetId: "empty",
      fetchedAt: "2024-01-01T00:00:00.000Z",
      tabs: [],
      totalRows: 0,
    };
    const hash = computeHash(empty);
    expect(hash).toHaveLength(64);
  });
});
