import { describe, expect, it } from "vitest";
import { normalizeDocxPropertyOptions } from "./command-properties.js";

describe("document property option types", () => {
  it("parses CLI values from declared types without changing caller options", () => {
    const source = { name: "core:revision", value: "12", dryRun: true };
    expect(normalizeDocxPropertyOptions(source, true)).toEqual({ name: "core:revision", value: 12, dryRun: true });
    expect(source.value).toBe("12");
    expect(normalizeDocxPropertyOptions({ name: "custom:Reviewed", value: "false", type: "boolean" }, true).value).toBe(false);
    expect(normalizeDocxPropertyOptions({ name: "custom:Temperature", value: "-12.25e1", type: "number" }, true).value).toBe(-122.5);
    expect(normalizeDocxPropertyOptions({ name: "custom:Count", value: "0", type: "integer" }, true).value).toBe(0);
    expect(normalizeDocxPropertyOptions({ name: "core:title", value: "" }, true).value).toBe("");
    expect(normalizeDocxPropertyOptions({ name: "core:title", value: "false" }, true).value).toBe("false");
  });

  it("keeps SDK scalar types strict and accepts explicitly typed custom names", () => {
    expect(normalizeDocxPropertyOptions({ name: "core:revision", value: 3 }, false).value).toBe(3);
    expect(normalizeDocxPropertyOptions({ name: "Survey score", type: "number", value: 4.25 }, false).value).toBe(4.25);
    expect(() => normalizeDocxPropertyOptions({ name: "core:revision", value: "3" }, false)).toThrow();
    expect(() => normalizeDocxPropertyOptions({ name: "Reviewed", type: "boolean", value: "false" }, false)).toThrow();
    expect(normalizeDocxPropertyOptions({ name: "Reviewed", value: false }, false)).toEqual({ name: "Reviewed", value: false });
    expect(normalizeDocxPropertyOptions({ name: "custom:title", value: "Coastal survey" }, false).value).toBe("Coastal survey");
    expect(normalizeDocxPropertyOptions({ name: "custom:title", type: "boolean", value: true }, false).value).toBe(true);
  });

  it("retains unknown custom values for explicit post-admission type resolution", () => {
    expect(normalizeDocxPropertyOptions({ name: "custom:Checked", value: "false" }, true)).toEqual({ name: "custom:Checked", value: "false" });
    expect(normalizeDocxPropertyOptions({ name: "custom:Count", value: "003" }, true)).toEqual({ name: "custom:Count", value: "003" });
    expect(() => normalizeDocxPropertyOptions({ name: "custom:Checked", value: null }, false)).toThrow();
    expect(() => normalizeDocxPropertyOptions({ name: "custom:Checked", value: {} }, false)).toThrow();
  });

  it.each(["title", "subject", "author", "keywords", "comments", "lastModifiedBy", "category", "contentStatus", "identifier", "language", "version"])("limits core %s to 255 Unicode scalars", name => {
    expect(normalizeDocxPropertyOptions({ name: `core:${name}`, value: "🌊".repeat(255) }, false).value).toBe("🌊".repeat(255));
    expect(() => normalizeDocxPropertyOptions({ name: `core:${name}`, value: "🌊".repeat(256) }, false)).toThrow();
    expect(() => normalizeDocxPropertyOptions({ name: `core:${name}`, value: "\ud800" }, false)).toThrow();
  });

  it.each(["company", "manager", "template"])("accepts writable extended %s without imposing core limits", name => {
    expect(normalizeDocxPropertyOptions({ name: `extended:${name}`, value: "a".repeat(300) }, false).value).toBe("a".repeat(300));
    expect(normalizeDocxPropertyOptions({ name, value: "Harbour" }, true).value).toBe("Harbour");
  });

  it.each(["pages", "words", "characters", "charactersWithSpaces", "lines", "paragraphs", "totalTime", "application", "appVersion"])("rejects cached extended %s", name => {
    expect(() => normalizeDocxPropertyOptions({ name: `extended:${name}`, value: "1" }, true)).toThrow();
    expect(() => normalizeDocxPropertyOptions({ name: `extended:${name}`, value: 1 }, false)).toThrow();
  });

  it.each(["created", "modified", "lastPrinted"])("validates UTC instants for %s", name => {
    expect(normalizeDocxPropertyOptions({ name, value: "2024-02-29T12:34:56.123Z" }, true).value).toBe("2024-02-29T12:34:56.123Z");
    for (const value of ["2025-02-29T12:34:56Z", "2024-01-01", "2024-01-01T00:00:00+00:00", "2024-01-01T24:00:00Z", null]) {
      expect(() => normalizeDocxPropertyOptions({ name: `core:${name}`, value }, false)).toThrow();
    }
  });

  it.each([
    { name: "core:revision", value: "0" }, { name: "core:revision", value: "-1" },
    { name: "core:revision", value: "1.5" }, { name: "core:revision", value: "9007199254740992" },
    { name: "core:revision", value: " 1" }, { name: "core:revision", value: "0x10" },
    { name: "core:revision", value: "" }, { name: "core:title", value: null },
    { name: "core:title", value: "Annual survey", type: "number" },
    { name: "core:revision", value: "1", type: "string" },
    { name: "extended:pages", value: "1", type: "integer" },
    { name: "unknown:Name", value: "a", type: "string" },
    { name: "custom:", value: "a", type: "string" },
    { name: "", value: "a", type: "string" },
    { name: "custom:Valid", value: "TRUE", type: "boolean" },
    { name: "custom:Valid", value: "Infinity", type: "number" },
    { name: "custom:Valid", value: "1_000", type: "number" },
    { name: "custom:Valid", value: "1", type: null },
    { name: "custom:Valid", value: "1", type: "decimal" },
  ])("rejects invalid property options %j", options => {
    expect(() => normalizeDocxPropertyOptions(options, true)).toThrow();
  });
});

it("defers unqualified native spelling to admitted custom metadata", () => {
  expect(normalizeDocxPropertyOptions({ name: "title", value: "false", type: "boolean" }, true).value).toBe(false);
  expect(normalizeDocxPropertyOptions({ name: "pages", value: 2, type: "integer" }, false).value).toBe(2);
});
it("accepts finite number properties without applying integer-only precision rules", () => {
  expect(normalizeDocxPropertyOptions({ name: "custom:Magnitude", type: "number", value: 1e16 }, false).value).toBe(1e16);
  expect(normalizeDocxPropertyOptions({ name: "custom:Magnitude", type: "number", value: "1e16" }, true).value).toBe(1e16);
  expect(() => normalizeDocxPropertyOptions({ name: "custom:Count", type: "integer", value: 1e16 }, false)).toThrow();
});

it("retains opaque native names for package-aware refusal", () => {
  for (const name of ["core:Unlisted", "extended:Unlisted"]) expect(normalizeDocxPropertyOptions({ name, value: "Original", type: "string" }, false)).toEqual({ name, value: "Original", type: "string" });
});
