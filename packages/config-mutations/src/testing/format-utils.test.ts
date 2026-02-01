import { describe, it, expect } from "vitest";
import {
  parseToml,
  serializeToml,
  parseJson,
  serializeJson
} from "./format-utils.js";

describe("format utils", () => {
  it("parses TOML into a config object", () => {
    expect(parseToml('key = "value"')).toEqual({ key: "value" });
  });

  it("serializes TOML with trailing newline", () => {
    const output = serializeToml({ key: "value" });
    expect(output).toContain('key = "value"');
    expect(output.endsWith("\n")).toBe(true);
  });

  it("parses JSON into a config object", () => {
    expect(parseJson('{"key": "value"}')).toEqual({ key: "value" });
  });

  it("serializes JSON with 2-space indentation", () => {
    expect(serializeJson({ key: "value" })).toBe('{\n  "key": "value"\n}\n');
  });
});
