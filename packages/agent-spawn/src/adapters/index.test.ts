import { describe, it, expect } from "bun:test";
import { adaptClaude } from "./claude.js";
import { adaptCodex } from "./codex.js";
import { adaptKimi } from "./kimi.js";
import { adaptNative } from "./native.js";
import { adaptOpenCode } from "./opencode.js";
import { getAdapter } from "./index.js";

describe("adapters barrel", () => {
  it("returns adapter functions by type", () => {
    expect(getAdapter("codex")).toBe(adaptCodex);
    expect(getAdapter("claude")).toBe(adaptClaude);
    expect(getAdapter("kimi")).toBe(adaptKimi);
    expect(getAdapter("native")).toBe(adaptNative);
    expect(getAdapter("opencode")).toBe(adaptOpenCode);
  });

  it("throws for unknown adapter type", () => {
    expect(() => getAdapter("unknown" as any)).toThrowError("Unknown adapter");
  });
});
