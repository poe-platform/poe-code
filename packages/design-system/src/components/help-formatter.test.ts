import { describe, expect, it } from "vitest";
import { withOutputFormat } from "../internal/output-format.js";
import {
  formatColumns,
  formatCommandList,
  formatOptionList
} from "./help-formatter.js";

describe("formatColumns", () => {
  it("aligns left to min(maxLen + gap, maxLeftWidth)", () => {
    const result = formatColumns({
      rows: [
        { left: "alpha", right: "first" },
        { left: "bravo1", right: "second" }
      ],
      totalWidth: 80,
      minLeftWidth: 1,
      maxLeftWidth: 8,
      gap: 3,
      indent: 2
    });

    expect(result).toBe("  alpha   first\n  bravo1  second");
  });

  it("aligns left to minLeftWidth when content plus gap is smaller", () => {
    const result = formatColumns({
      rows: [{ left: "a", right: "first" }],
      totalWidth: 80,
      minLeftWidth: 8,
      maxLeftWidth: 20,
      gap: 2,
      indent: 0
    });

    expect(result).toBe("a       first");
  });

  it("wraps right at totalWidth - leftWidth - indent", () => {
    const result = formatColumns({
      rows: [{ left: "cmd", right: "one two three four five" }],
      totalWidth: 25,
      minLeftWidth: 1,
      maxLeftWidth: 20,
      gap: 1,
      indent: 1
    });

    expect(result).toBe(" cmd one two three four\n     five");
  });

  it("keeps long unbreakable tokens intact when they exceed right width", () => {
    const result = formatColumns({
      rows: [{ left: "cmd", right: "short supercalifragilisticexpialidocious tail" }],
      totalWidth: 18,
      minLeftWidth: 1,
      maxLeftWidth: 20,
      gap: 1,
      indent: 0
    });

    expect(result).toBe("cmd short\n    supercalifragilisticexpialidocious\n    tail");
  });

  it("preserves continuation indent", () => {
    const result = formatColumns({
      rows: [{ left: "left", right: "alpha beta gamma delta" }],
      totalWidth: 18,
      minLeftWidth: 1,
      maxLeftWidth: 20,
      gap: 2,
      indent: 3
    });

    expect(result.split("\n")[1]?.startsWith(" ".repeat(9))).toBe(true);
  });

  it("does not widen the column for ANSI-styled left tokens", () => {
    const result = formatColumns({
      rows: [
        { left: "\u001b[31mred\u001b[39m", right: "colored" },
        { left: "blue", right: "plain" }
      ],
      totalWidth: 80,
      minLeftWidth: 1,
      maxLeftWidth: 20,
      gap: 2,
      indent: 0
    });

    expect(result).toBe("\u001b[31mred\u001b[39m   colored\nblue  plain");
  });

  it("returns an empty string for an empty rows array", () => {
    expect(formatColumns({ rows: [] })).toBe("");
  });
});

describe("help formatter lists", () => {
  it("formats command lists through columns", () => {
    const result = withOutputFormat("markdown", () =>
      formatCommandList([
        { name: "configure", description: "Set up provider credentials" },
        { name: "run", description: "Run an agent" }
      ])
    );

    expect(result).toMatchInlineSnapshot(`
      "  \`configure\`   Set up provider credentials
        \`run\`         Run an agent"
    `);
  });

  it("formats option lists through columns", () => {
    const result = withOutputFormat("markdown", () =>
      formatOptionList([
        { flags: "--agent <name>", description: "Agent to configure" },
        { flags: "--yes", description: "Accept defaults" }
      ])
    );

    expect(result).toMatchInlineSnapshot(`
      "  \`--agent <name>\`   Agent to configure
        \`--yes\`            Accept defaults"
    `);
  });
});
