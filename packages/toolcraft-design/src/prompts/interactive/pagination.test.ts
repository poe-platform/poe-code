import { describe, expect, it } from "vitest";
import { wrapAnsi } from "fast-wrap-ansi";
import { stripAnsi } from "../../internal/strip-ansi.js";
import { limitOptions } from "./pagination.js";
import { createPromptHarness } from "./test-helpers.js";

const options = Array.from({ length: 10 }, (_, index) => `Option ${index}`);

describe("limitOptions", () => {
  it("shows all options without markers when the list fits", () => {
    const { output } = createPromptHarness();
    const visible = limitOptions({
      cursor: 0,
      options: options.slice(0, 3),
      output,
      maxItems: 5,
      style: (option) => option
    });

    expect(visible).toEqual(["Option 0", "Option 1", "Option 2"]);
  });

  it("adds bottom marker at the beginning of a long list", () => {
    const { output } = createPromptHarness();
    const visible = limitOptions({
      cursor: 0,
      options,
      output,
      maxItems: 5,
      style: (option) => option
    });

    expect(stripAnsi(visible.at(-1) ?? "")).toBe("...");
    expect(visible).not.toContain("Option 9");
  });

  it("adds top marker at the end of a long list", () => {
    const { output } = createPromptHarness();
    const visible = limitOptions({
      cursor: 9,
      options,
      output,
      maxItems: 5,
      style: (option) => option
    });

    expect(stripAnsi(visible[0] ?? "")).toBe("...");
    expect(visible).toContain("Option 9");
  });

  it("adds both markers in the middle of a long list", () => {
    const { output } = createPromptHarness();
    const visible = limitOptions({
      cursor: 5,
      options,
      output,
      maxItems: 5,
      style: (option) => option
    });

    expect(stripAnsi(visible[0] ?? "")).toBe("...");
    expect(stripAnsi(visible.at(-1) ?? "")).toBe("...");
    expect(visible).toContain("Option 5");
  });

  it("wraps long options to the available columns", () => {
    const { output } = createPromptHarness({ columns: 18 });
    const visible = limitOptions({
      cursor: 0,
      options: ["a long option label"],
      output,
      maxItems: 5,
      columnPadding: 2,
      style: (option) => option
    });

    expect(visible[0]!.split("\n").length).toBeGreaterThan(1);
  });

  it.each([
    [0, ["> Alpha", "Bravo", "..."]],
    [2, ["...", "> Charlie", "..."]],
    [4, ["...", "Delta", "> Echo"]]
  ] as const)("keeps cursor %i visible with accurate markers in seven rows", (cursor, expected) => {
    const { output } = createPromptHarness({ rows: 7, columns: 80 });
    const visible = limitOptions({
      cursor,
      options: ["Alpha", "Bravo", "Charlie", "Delta", "Echo"],
      output,
      style: (option, active) => active ? `> ${option}` : option
    }).map(stripAnsi);

    expect(visible).toEqual(expected);
    expect(visible.join("\n").split("\n")).toHaveLength(3);
  });

  it.each([0, 1, 2])("keeps wrapped cursor %i in a contiguous window with final markers", (cursor) => {
    const { output } = createPromptHarness({ rows: 10, columns: 12 });
    const labels = ["Alpha long label", "Bravo long label", "Charlie long label"];
    const rendered = labels.map((label, index) => wrapAnsi(`${index === cursor ? "> " : "  "}${label}`, 9, { hard: true, trim: false }));
    const visible = limitOptions({
      cursor,
      options: labels,
      output,
      columnPadding: 3,
      style: (option, active) => `${active ? "> " : "  "}${option}`
    }).map(stripAnsi);
    const indices = visible.filter((entry) => entry !== "...").map((entry) => rendered.indexOf(entry));

    expect(visible).toContain(rendered[cursor]);
    expect(indices.every((index, offset) => index === indices[0]! + offset)).toBe(true);
    expect(visible[0] === "...").toBe(indices[0]! > 0);
    expect(visible.at(-1) === "...").toBe(indices.at(-1)! < labels.length - 1);
    expect(visible.join("\n").split("\n").length).toBeLessThanOrEqual(6);
  });

  it("counts wrapped omission markers against the row budget", () => {
    const { output } = createPromptHarness({ rows: 11, columns: 1 });
    const visible = limitOptions({
      cursor: 0,
      options: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
      output,
      maxItems: 5,
      style: (option) => option
    }).map(stripAnsi);

    expect(visible).toEqual(["A", "B", "C", "D", ".\n.\n."]);
    expect(visible.join("\n").split("\n")).toHaveLength(7);
  });

  it.each([1, 4, 5])("prioritizes the whole active option with only %i terminal rows", (rows) => {
    const { output } = createPromptHarness({ rows, columns: 80 });
    const visible = limitOptions({
      cursor: 2,
      options: ["Alpha", "Bravo", "Charlie", "Delta", "Echo"],
      output,
      style: (option, active) => active ? `> ${option}` : option
    }).map(stripAnsi);

    expect(visible).toEqual(["> Charlie"]);
  });

  it("keeps an entire active label taller than the workable budget", () => {
    const { output } = createPromptHarness({ rows: 7, columns: 12 });
    const label = "Charlie long label with several more words to wrap";
    const active = wrapAnsi(`> ${label}`, 9, { hard: true, trim: false });
    const visible = limitOptions({
      cursor: 1,
      options: ["Alpha", label, "Echo"],
      output,
      columnPadding: 3,
      style: (option, focused) => focused ? `> ${option}` : option
    }).map(stripAnsi);

    expect(active.split("\n").length).toBeGreaterThan(3);
    expect(visible).toEqual([active]);
  });

  it.each([1, 4, 5])("preserves the minimum-five windows for maxItems %i", (maxItems) => {
    const { output } = createPromptHarness({ rows: 20, columns: 80 });
    for (const [cursor, start, end] of [[0, 0, 5], [5, 3, 8], [9, 5, 10]]) {
      const visible = limitOptions({ cursor, options, output, maxItems, style: (option) => option }).map(stripAnsi);

      expect(visible).toEqual([
        ...(start > 0 ? ["..."] : []),
        ...options.slice(start, end),
        ...(end < options.length ? ["..."] : [])
      ]);
    }
  });

  it("preserves a normal full window and an empty list", () => {
    const { output } = createPromptHarness({ rows: 20, columns: 80 });

    expect(limitOptions({ cursor: 9, options, output, style: (option) => option })).toEqual(options);
    expect(limitOptions({ cursor: 0, options: [], output, style: (option) => option })).toEqual([]);
  });
});
