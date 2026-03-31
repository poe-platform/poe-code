import { describe, it, expect, beforeEach } from "bun:test";
import chalk from "chalk";
import { renderTable } from "./table.js";
import type { ThemePalette } from "../tokens/colors.js";
import { resetOutputFormatCache, resolveOutputFormat } from "../internal/output-format.js";

const identity = (s: string) => s;
const theme: ThemePalette = {
  header: identity,
  divider: identity,
  prompt: identity,
  number: identity,
  intro: identity,
  resolvedSymbol: "",
  errorSymbol: "",
  accent: identity,
  muted: identity,
  success: identity,
  warning: identity,
  error: identity,
  info: identity,
};

const sampleOptions = {
  theme,
  columns: [
    { name: "Name", title: "Name", alignment: "left" as const, maxLen: 20 },
    { name: "Value", title: "Value", alignment: "left" as const, maxLen: 10 },
  ],
  rows: [
    { Name: "alpha", Value: "1" },
    { Name: "beta", Value: "2" },
  ],
};

function setFormat(format: string): void {
  resetOutputFormatCache();
  resolveOutputFormat({ OUTPUT_FORMAT: format });
}

describe("renderTable", () => {
  beforeEach(() => {
    resetOutputFormatCache();
  });

  describe("terminal format (default)", () => {
    it("renders a terminal table with box-drawing characters", () => {
      const result = renderTable(sampleOptions);
      expect(result).toContain("alpha");
      expect(result).toContain("beta");
      expect(result).toContain("┌");
    });
  });

  describe("markdown format", () => {
    beforeEach(() => {
      setFormat("markdown");
    });

    it("renders a markdown table with headers and rows", () => {
      const result = renderTable(sampleOptions);

      const lines = result.split("\n");
      expect(lines[0]).toBe("| Name | Value |");
      expect(lines[1]).toBe("| :--- | :--- |");
      expect(lines[2]).toBe("| alpha | 1 |");
      expect(lines[3]).toBe("| beta | 2 |");
      expect(lines).toHaveLength(4);
    });

    it("respects column alignment", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Left", title: "Left", alignment: "left", maxLen: 10 },
          { name: "Right", title: "Right", alignment: "right", maxLen: 10 },
        ],
        rows: [{ Left: "a", Right: "b" }],
      });

      const lines = result.split("\n");
      expect(lines[1]).toBe("| :--- | ---: |");
    });

    it("strips ANSI escape codes from cell values", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Name", title: "Name", alignment: "left", maxLen: 20 },
        ],
        rows: [{ Name: chalk.red("colored") }],
      });

      const lines = result.split("\n");
      expect(lines[2]).toBe("| colored |");
    });

    it("handles empty rows", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Col", title: "Col", alignment: "left", maxLen: 10 },
        ],
        rows: [],
      });

      const lines = result.split("\n");
      expect(lines[0]).toBe("| Col |");
      expect(lines[1]).toBe("| :--- |");
      expect(lines).toHaveLength(2);
    });

    it("escapes pipe characters in cell content", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Expr", title: "Expr", alignment: "left", maxLen: 20 },
        ],
        rows: [{ Expr: "a | b" }],
      });

      const lines = result.split("\n");
      expect(lines[2]).toBe("| a \\| b |");
    });
  });

  describe("json format", () => {
    beforeEach(() => {
      setFormat("json");
    });

    it("returns valid JSON array", () => {
      const result = renderTable(sampleOptions);

      const parsed = JSON.parse(result);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
    });

    it("uses column names as keys", () => {
      const result = renderTable(sampleOptions);

      const parsed = JSON.parse(result);
      expect(parsed[0]).toEqual({ Name: "alpha", Value: "1" });
      expect(parsed[1]).toEqual({ Name: "beta", Value: "2" });
    });

    it("strips ANSI from values", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Name", title: "Name", alignment: "left", maxLen: 20 },
        ],
        rows: [{ Name: chalk.red("colored") }],
      });

      const parsed = JSON.parse(result);
      expect(parsed[0].Name).toBe("colored");
    });

    it("returns empty array for no rows", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Col", title: "Col", alignment: "left", maxLen: 10 },
        ],
        rows: [],
      });

      expect(JSON.parse(result)).toEqual([]);
    });
  });
});
