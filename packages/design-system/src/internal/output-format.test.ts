import { describe, it, expect, beforeEach } from "bun:test";
import { resolveOutputFormat, resetOutputFormatCache } from "./output-format.js";

describe("resolveOutputFormat", () => {
  beforeEach(() => {
    resetOutputFormatCache();
  });

  it("defaults to terminal when env var is unset", () => {
    expect(resolveOutputFormat({})).toBe("terminal");
  });

  it("returns markdown when OUTPUT_FORMAT=markdown", () => {
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "markdown" })).toBe("markdown");
  });

  it("returns json when OUTPUT_FORMAT=json", () => {
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "json" })).toBe("json");
  });

  it("returns terminal when OUTPUT_FORMAT=terminal", () => {
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "terminal" })).toBe("terminal");
  });

  it("returns terminal for unknown values", () => {
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "csv" })).toBe("terminal");
  });

  it("is case-insensitive", () => {
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "MARKDOWN" })).toBe("markdown");
    resetOutputFormatCache();
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "Json" })).toBe("json");
  });

  it("caches the result after first call", () => {
    resolveOutputFormat({ OUTPUT_FORMAT: "json" });
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "markdown" })).toBe("json");
  });

  it("resetOutputFormatCache clears the cache", () => {
    resolveOutputFormat({ OUTPUT_FORMAT: "json" });
    resetOutputFormatCache();
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "markdown" })).toBe("markdown");
  });
});
