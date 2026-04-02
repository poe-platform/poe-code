import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveOutputFormat,
  resetOutputFormatCache,
  withOutputFormat
} from "./output-format.js";

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

  it("uses the scoped override inside withOutputFormat", () => {
    resolveOutputFormat({ OUTPUT_FORMAT: "json" });

    const scoped = withOutputFormat("markdown", () => resolveOutputFormat());

    expect(scoped).toBe("markdown");
    expect(resolveOutputFormat()).toBe("json");
  });

  it("prefers the innermost scoped override", () => {
    const scoped = withOutputFormat("markdown", () =>
      withOutputFormat("json", () => resolveOutputFormat())
    );

    expect(scoped).toBe("json");
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "terminal" })).toBe("terminal");
  });

  it("propagates the scoped override through await", async () => {
    const scoped = await withOutputFormat("markdown", async () => {
      await Promise.resolve();
      return resolveOutputFormat({ OUTPUT_FORMAT: "json" });
    });

    expect(scoped).toBe("markdown");
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "json" })).toBe("json");
  });

  it("restores the outer scoped override after an inner async override completes", async () => {
    const scoped = await withOutputFormat("markdown", async () => {
      await withOutputFormat("json", async () => {
        await Promise.resolve();
        expect(resolveOutputFormat({ OUTPUT_FORMAT: "terminal" })).toBe("json");
      });

      return resolveOutputFormat({ OUTPUT_FORMAT: "terminal" });
    });

    expect(scoped).toBe("markdown");
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "terminal" })).toBe("terminal");
  });

  it("propagates the scoped override through timer callbacks", async () => {
    const scoped = await withOutputFormat("markdown", async () =>
      new Promise<ReturnType<typeof resolveOutputFormat>>((resolve) => {
        setTimeout(() => {
          resolve(resolveOutputFormat({ OUTPUT_FORMAT: "json" }));
        }, 0);
      })
    );

    expect(scoped).toBe("markdown");
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "json" })).toBe("json");
  });
});
