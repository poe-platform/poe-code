import { describe, expect, it } from "vitest";
import { DuplicateToolError, PluginSetupError, PromptTransformError } from "./errors.js";

describe("runtime errors", () => {
  it("creates DuplicateToolError with the colliding tool name", () => {
    const error = new DuplicateToolError("search_web");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DuplicateToolError");
    expect(error.message).toContain("search_web");
    expect(error.toolName).toBe("search_web");
  });

  it("creates PluginSetupError and wraps the original error", () => {
    const cause = new Error("boom");
    const error = new PluginSetupError("audit-plugin", cause);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PluginSetupError");
    expect(error.message).toContain("audit-plugin");
    expect(error.pluginName).toBe("audit-plugin");
    expect(error.cause).toBe(cause);
  });

  it("preserves non-Error causes in PluginSetupError", () => {
    const cause = { reason: "misconfigured" };
    const error = new PluginSetupError("audit-plugin", cause);

    expect(error.cause).toBe(cause);
  });

  it("creates PromptTransformError and wraps the original error", () => {
    const cause = new Error("invalid prompt");
    const error = new PromptTransformError("sanitize-plugin", cause);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PromptTransformError");
    expect(error.message).toContain("sanitize-plugin");
    expect(error.pluginName).toBe("sanitize-plugin");
    expect(error.cause).toBe(cause);
  });

  it("preserves primitive causes in PromptTransformError", () => {
    const cause = "invalid-token";
    const error = new PromptTransformError("sanitize-plugin", cause);

    expect(error.cause).toBe(cause);
  });
});
