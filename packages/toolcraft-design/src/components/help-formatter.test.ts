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

  it("puts overwide left cells on their own line before the description", () => {
    const result = formatColumns({
      rows: [{ left: "run [doc] [--agent <string>]", right: "Run the full loop." }],
      totalWidth: 50,
      minLeftWidth: 1,
      maxLeftWidth: 12,
      gap: 2,
      indent: 2
    });

    expect(result).toBe("  run [doc] [--agent <string>]\n              Run the full loop.");
  });

  it("puts max-width left cells on their own line before the description", () => {
    const result = formatColumns({
      rows: [{ left: "--plan.strict-value", right: "Enable strict mode." }],
      totalWidth: 60,
      minLeftWidth: 1,
      maxLeftWidth: 19,
      gap: 2,
      indent: 2
    });

    expect(result).toBe("  --plan.strict-value\n                     Enable strict mode.");
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

  it("does not pad rows with empty right cells", () => {
    const result = formatColumns({
      rows: [
        { left: "deploy --service <value>", right: "" },
        { left: "approvals", right: "Inspect approvals" }
      ],
      totalWidth: 80,
      minLeftWidth: 1,
      maxLeftWidth: 32,
      gap: 2,
      indent: 2
    });

    expect(result).toBe("  deploy --service <value>\n  approvals                 Inspect approvals");
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

  it("does not count terminal hyperlinks as visible label width", () => {
    const linked = "\u001b]8;;https://example.test\u0007go\u001b]8;;\u0007";
    const result = formatColumns({
      rows: [
        { left: linked, right: "linked" },
        { left: "go", right: "plain" }
      ],
      totalWidth: 120,
      minLeftWidth: 1,
      maxLeftWidth: 80,
      gap: 1,
      indent: 0
    });

    expect(result).toBe(`${linked} linked\ngo plain`);
  });

  it("aligns descriptions after wide terminal glyphs", () => {
    const result = formatColumns({
      rows: [
        { left: "界", right: "wide" },
        { left: "aa", right: "ascii" }
      ],
      totalWidth: 40,
      minLeftWidth: 3,
      maxLeftWidth: 3,
      gap: 1,
      indent: 0
    });

    expect(result).toBe("界 wide\naa ascii");
  });

  it("rejects invalid numeric layout options", () => {
    expect(() => formatColumns({ rows: [{ left: "run", right: "Run" }], maxLeftWidth: Number.NaN }))
      .toThrow("maxLeftWidth must be a finite non-negative number");
    expect(() => formatColumns({ rows: [{ left: "run", right: "Run" }], indent: -1 }))
      .toThrow("indent must be a finite non-negative number");
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

  it("keeps command names on one rendered row", () => {
    const result = formatCommandList([
      { name: "safe\n  forged --all", description: "Description" }
    ]);

    expect(result).not.toContain("\n  forged --all");
  });

  it("indents nested command rows by depth", () => {
    const result = formatCommandList([
      { name: "calendar", description: "Google Calendar events.", depth: 0 },
      { name: "events", description: "", depth: 1 },
      { name: "list", description: "List calendar events", depth: 2 }
    ]);
    const plain = result.replace(/\[[0-9;]*m/g, "");

    expect(plain).toContain("  calendar");
    expect(plain).toContain("    events");
    expect(plain).toContain("      list");
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
