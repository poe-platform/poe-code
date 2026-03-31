import { describe, it, expect } from "bun:test";
import { stripModelNamespace } from "./model-utils.js";

describe("stripModelNamespace", () => {
  it("strips provider prefix from namespaced model", () => {
    expect(stripModelNamespace("anthropic/claude-opus-4.6")).toBe("claude-opus-4.6");
  });

  it("strips any provider prefix", () => {
    expect(stripModelNamespace("openai/gpt-5.2")).toBe("gpt-5.2");
    expect(stripModelNamespace("novitaai/kimi-k2.5")).toBe("kimi-k2.5");
  });

  it("returns bare model ID unchanged", () => {
    expect(stripModelNamespace("claude-opus-4.6")).toBe("claude-opus-4.6");
    expect(stripModelNamespace("o3")).toBe("o3");
  });

  it("handles model with multiple slashes by stripping only the first segment", () => {
    expect(stripModelNamespace("provider/model/variant")).toBe("model/variant");
  });
});
