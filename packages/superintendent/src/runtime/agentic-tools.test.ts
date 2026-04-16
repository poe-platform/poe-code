import { describe, expect, it } from "vitest";
import {
  createBuilderTool,
  createInspectorTool,
  parseBuilderRunInput,
  parseInspectorRunInput
} from "./agentic-tools.js";

describe("createBuilderTool", () => {
  it("declares prompt as the only required field", () => {
    const tool = createBuilderTool();

    expect(tool.name).toBe("builder.run");
    expect(tool.inputSchema.required).toEqual(["prompt"]);
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.inputSchema.properties.prompt?.type).toBe("string");
  });
});

describe("createInspectorTool", () => {
  it("includes inspector names as the enum when configured", () => {
    const tool = createInspectorTool(["code-quality", "testing"]);

    expect(tool.name).toBe("inspector.run");
    expect(tool.inputSchema.required).toEqual(["name"]);
    expect(tool.inputSchema.properties.name?.enum).toEqual(["code-quality", "testing"]);
    expect(tool.inputSchema.properties.prompt).toBeDefined();
  });

  it("omits the enum when no inspectors are configured", () => {
    const tool = createInspectorTool([]);

    expect(tool.inputSchema.properties.name?.enum).toBeUndefined();
    expect(tool.description).toContain("No inspectors are configured");
  });
});

describe("parseBuilderRunInput", () => {
  it("returns the prompt when valid", () => {
    expect(parseBuilderRunInput({ prompt: "Build the next thing" })).toEqual({
      prompt: "Build the next thing"
    });
  });

  it("rejects non-object input", () => {
    expect(() => parseBuilderRunInput("oops")).toThrow(
      "builder.run requires an object input"
    );
  });

  it("rejects empty prompts", () => {
    expect(() => parseBuilderRunInput({ prompt: "" })).toThrow(
      "builder.run `prompt` must be a non-empty string"
    );
    expect(() => parseBuilderRunInput({ prompt: "   " })).toThrow(
      "builder.run `prompt` must be a non-empty string"
    );
  });
});

describe("parseInspectorRunInput", () => {
  it("returns the name when prompt is omitted", () => {
    expect(parseInspectorRunInput({ name: "code-quality" }, ["code-quality"])).toEqual({
      name: "code-quality"
    });
  });

  it("returns the name and prompt when both are provided", () => {
    expect(
      parseInspectorRunInput(
        { name: "code-quality", prompt: "Re-check after the fix" },
        ["code-quality"]
      )
    ).toEqual({
      name: "code-quality",
      prompt: "Re-check after the fix"
    });
  });

  it("rejects names that are not configured", () => {
    expect(() =>
      parseInspectorRunInput({ name: "missing" }, ["code-quality"])
    ).toThrow('inspector.run name "missing" is not configured');
  });

  it("allows any name when no inspectors are listed (unconfigured doc)", () => {
    expect(parseInspectorRunInput({ name: "anything" }, [])).toEqual({
      name: "anything"
    });
  });

  it("rejects empty prompts when provided", () => {
    expect(() =>
      parseInspectorRunInput({ name: "code-quality", prompt: "" }, ["code-quality"])
    ).toThrow("inspector.run `prompt` must be a non-empty string when provided");
  });
});
