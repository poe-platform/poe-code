import { describe, expect, it } from "bun:test";
import { text } from "./text.js";

describe("text.selectLabel", () => {
  it("returns plain label when detail is undefined", () => {
    expect(text.selectLabel("my-file.md")).toBe("my-file.md");
  });

  it("returns plain label when detail is empty", () => {
    expect(text.selectLabel("my-file.md", "")).toBe("my-file.md");
  });

  it("appends dim detail to label", () => {
    const result = text.selectLabel("my-file.md", "codex · ×3");

    expect(result).toContain("my-file.md");
    expect(result).toContain("codex · ×3");
    expect(result).not.toBe("my-file.md codex · ×3");
  });
});
