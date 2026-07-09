import { describe, expect, it } from "vitest";
import {
  formatColumns,
  formatCommandList,
  formatOptionList
} from "./help-formatter-plain.js";

const ansiEscapePattern = /\x1b\[[0-9;]*m/;

describe("plain help formatter", () => {
  it("does not emit ANSI escape codes", () => {
    const result = formatColumns({
      rows: [
        { left: "\u001b[31mred\u001b[39m", right: "colored\u001b[2K" },
        { left: "blue", right: "\u001b[1mplain\u001b[22m" }
      ],
      totalWidth: 80,
      minLeftWidth: 1,
      maxLeftWidth: 20,
      gap: 2,
      indent: 0
    });

    expect(ansiEscapePattern.test(result)).toBe(false);
    expect(result).not.toContain("\u001b");
    expect(result).toBe("red   colored\nblue  plain");
  });

  it("converts non-ASCII input without changing formatter width accounting", () => {
    const result = formatColumns({
      rows: [
        { left: "café", right: "ready" },
        { left: "globe 🌍", right: "wide" }
      ],
      totalWidth: 80,
      minLeftWidth: 1,
      maxLeftWidth: 20,
      gap: 2,
      indent: 0
    });

    expect(result).toBe("caf?      ready\nglobe ??  wide");
  });

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

  it("formats command lists without text styling", () => {
    const result = formatCommandList([
      { name: "configure", description: "Set up provider credentials" },
      { name: "run", description: "Run an agent" }
    ]);

    expect(ansiEscapePattern.test(result)).toBe(false);
    expect(result).toBe("  configure   Set up provider credentials\n  run         Run an agent");
  });

  it("indents nested command rows by depth without text styling", () => {
    const result = formatCommandList([
      { name: "calendar", description: "Google Calendar events.", depth: 0 },
      { name: "events", description: "", depth: 1 },
      { name: "list", description: "List calendar events", depth: 2 }
    ]);

    expect(ansiEscapePattern.test(result)).toBe(false);
    expect(result).toContain("  calendar");
    expect(result).toContain("    events");
    expect(result).toContain("      list");
  });

  it("formats option lists without text styling", () => {
    const result = formatOptionList([
      { flags: "--agent <name>", description: "Agent to configure" },
      { flags: "--yes", description: "Accept defaults" }
    ]);

    expect(ansiEscapePattern.test(result)).toBe(false);
    expect(result).toBe("  --agent <name>   Agent to configure\n  --yes            Accept defaults");
  });
});
