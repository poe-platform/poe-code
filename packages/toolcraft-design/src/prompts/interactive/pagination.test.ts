import { describe, expect, it } from "vitest";
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
});
