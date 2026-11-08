import { describe, expect, it } from "vitest";
import { ScreenBuffer } from "../buffer.js";
import { displayWidth } from "../terminal-width.js";
import { renderFooter } from "./footer.js";

function line(buffer: ScreenBuffer, y: number): string {
  return Array.from({ length: buffer.width }, (_, x) => buffer.get(x, y).ch).join("");
}

describe("dashboard session footer", () => {
  it("keeps hints above the directory and agent/model status", () => {
    const buffer = new ScreenBuffer(100, 2);
    renderFooter(buffer, { x: 0, y: 0, width: 100, height: 2 }, [{ key: "q", label: "Quit" }], {
      cwd: "/workspace/project", agent: "codex", model: "gpt-5.2"
    });
    expect(line(buffer, 0)).toContain("q Quit");
    expect(line(buffer, 1).startsWith("/workspace/project")).toBe(true);
    expect(line(buffer, 1).endsWith("codex · gpt-5.2")).toBe(true);
  });

  it.each([1, 12, 40])("clips long Unicode context to %i cells without touching the border", (width) => {
    const buffer = new ScreenBuffer(width + 2, 2);
    buffer.put(0, 1, "│");
    buffer.put(width + 1, 1, "│");
    renderFooter(buffer, { x: 1, y: 0, width, height: 2 }, [], {
      cwd: "/workspace/项目/" + "long/".repeat(20), agent: "codex", model: "very-long-model-name"
    });
    expect(buffer.get(0, 1).ch).toBe("│");
    expect(buffer.get(width + 1, 1).ch).toBe("│");
    expect(displayWidth(line(buffer, 1))).toBe(width + 2);
    expect(line(buffer, 1)).toContain("…");
  });

  it("labels an unspecified model and sanitizes terminal controls", () => {
    const buffer = new ScreenBuffer(80, 1);
    renderFooter(buffer, { x: 0, y: 0, width: 80, height: 1 }, [], {
      cwd: "/workspace/\u001b[31mproject", agent: "codex"
    });
    expect(line(buffer, 0)).toContain("/workspace/project");
    expect(line(buffer, 0)).toContain("codex · default model");
  });
});
