import { describe, expect, it } from "vitest";
import { ScreenBuffer } from "../buffer.js";
import type { OutputItem } from "../types.js";
import { renderOutputPane } from "./output-pane.js";
import { getTheme } from "../../internal/theme-detect.js";

function rows(items: OutputItem[], details = false) {
  const buffer = new ScreenBuffer(80, 15);
  renderOutputPane(buffer, { x: 0, y: 0, width: 80, height: 15 }, items, 0, { conversation: true, details });
  return Array.from({ length: 15 }, (_, y) => Array.from({ length: 80 }, (_, x) => buffer.get(x, y).ch).join("").trimEnd());
}

describe("concise conversation transcript", () => {
  it("distinguishes running, completed, and failed actions without relying on color", () => {
    const result = rows([
      { role: "action", kind: "tool", text: "Run tests", ts: 0 },
      { role: "action", kind: "success", text: "Read settings.ts", ts: 1 },
      { role: "action", kind: "error", text: "Build failed", ts: 2 }
    ]);
    expect(result.slice(0, 3)).toEqual(["›  Run tests", "✓  Read settings.ts", "!  Build failed"]);
  });

  it("keeps routine actions quiet while preserving visible errors and agent prose", () => {
    const buffer = new ScreenBuffer(80, 15);
    renderOutputPane(buffer, { x: 0, y: 0, width: 80, height: 15 }, [
      { role: "action", kind: "success", text: "Read settings.ts", ts: 0 },
      { kind: "status", text: "Builder starting", ts: 1 },
      { role: "action", kind: "error", text: "Build failed", ts: 2 },
      { role: "agent", kind: "info", text: "The fix is ready.", ts: 3 }
    ], 0, { conversation: true });
    expect(buffer.get(3, 0).style).toEqual(getTheme().styles.muted);
    expect(buffer.get(3, 1).style).toEqual(getTheme().styles.muted);
    expect(buffer.get(3, 2).style).toEqual(getTheme().styles.error);
    expect(buffer.get(3, 3).style).toEqual({});
  });

  it("keeps one separator after prose with trailing newlines", () => {
    const result = rows([
      { role: "agent", kind: "info", text: "Checks pass.\n\n", ts: 0 },
      { role: "action", kind: "tool", text: "Run build", ts: 1 }
    ]);
    expect(result.slice(0, 3)).toEqual(["•  Checks pass.", "", "›  Run build"]);
  });

  it("keeps reasoning available in details without crowding the normal transcript", () => {
    const items: OutputItem[] = [
      { role: "reasoning", kind: "status", text: "Reasoning summary for inspection", ts: 0 },
      { role: "agent", kind: "info", text: "The fix is ready.", ts: 1 }
    ];
    expect(rows(items).join("\n")).not.toContain("Reasoning summary");
    expect(rows(items, true).join("\n")).toContain("Reasoning summary");
  });
});
