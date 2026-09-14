import { expect, it } from "vitest";
import { DocxUsageError } from "./argument-json.js";
import { validateDocxOptionRules } from "./command-option-rules.js";

it.each([
  ["sanitize", { remove: ["revisions"] }],
  ["sanitize", { remove: ["comments"], revisionPolicy: "accept" }],
  ["revisions.add", { kind: "insert", author: "", timestamp: "2026-01-01T00:00:00Z" }],
  ["revisions.add", { kind: "insert", text: "", author: "", timestamp: "2026-01-01T00:00:00Z" }],
  ["revisions.add", { kind: "delete", text: "x", author: "", timestamp: "2026-01-01T00:00:00Z" }],
  ["comments.add", { text: "x" }],
  ["fields.add", { kind: "REF" }],
  ["fields.add", { kind: "PAGE", target: "anchor" }],
  ["bookmarks.add", { name: "9anchor" }],
  ["bookmarks.set", { name: "two words" }],
  ["links.add", { target: "javascript:example" }],
  ["lists.add", { start: -1 }],
  ["images.add", { width: { value: 0, unit: "in" } }],
  ["images.replace", { height: { value: -1, unit: "cm" } }],
  ["runs.set", { size: { value: 0, unit: "pt" } }],
  ["paragraphs.set", { spaceAfter: { value: -1, unit: "pt" } }],
  ["paragraphs.set", { lineSpacing: 0 }],
  ["sections.set", { pageWidth: { value: 2, unit: "in" }, leftMargin: { value: 72, unit: "pt" }, rightMargin: { value: 1, unit: "in" } }],
  ["paragraphs.format.set", {}],
  ["sections.columns.set", { columns: [] }],
  ["lists.levels.set", { levels: [{ level: 0, start: 1 }, { level: 0, start: 1 }] }]
])("rejects conditional option violations: %s", (operation, options) => {
  expect(() => validateDocxOptionRules(operation, options)).toThrow(DocxUsageError);
});

it.each([
  ["sanitize", { remove: ["revisions"], revisionPolicy: "reject" }],
  ["comments.add", { author: "", timestamp: "2026-01-01T00:00:00Z" }],
  ["revisions.add", { kind: "insert", text: "", allowEmpty: true, author: "", timestamp: "2026-01-01T00:00:00Z" }],
  ["fields.add", { kind: "SEQ", target: "Figure" }],
  ["links.add", { target: "https://example.invalid/path" }],
  ["paragraphs.set", { leftIndent: { value: -12, unit: "pt" }, spaceAfter: { value: 0, unit: "pt" } }],
  ["lists.add", { start: 0 }],
  ["images.set", { x: { value: -1, unit: "in" } }],
  ["sections.columns.set", { columns: [{ width: { value: 1, unit: "in" }, gapAfter: { value: 0, unit: "pt" } }] }]
])("accepts explicit empty values and legal geometry: %s", (operation, options) => {
  expect(() => validateDocxOptionRules(operation, options)).not.toThrow();
});

it.each([
  ["images.add", { width: { value: 1e308, unit: "in" } }],
  ["images.set", { x: { value: -1e20, unit: "emu" } }],
  ["paragraphs.set", { leftIndent: { value: Number.MAX_SAFE_INTEGER, unit: "pt" } }],
  ["images.add", { width: { value: 0.49, unit: "emu" } }],
  ["tables.set", { cellMargin: { value: -0.1, unit: "emu" } }],
  ["paragraphs.format.set", { borders: { top: { width: { value: 1e300, unit: "in" } } } }],
  ["sections.columns.set", { columns: [{ width: { value: 1, unit: "in" }, gapAfter: { value: 1, unit: "pt" } }] }],
  ["sections.columns.set", { gap: { value: 1, unit: "pt" }, columns: [{ width: { value: 1, unit: "in" } }] }],
  ["sections.columns.set", { equalWidth: true, columns: [{ width: { value: 1, unit: "in" } }, { width: { value: 2, unit: "in" } }] }],
  ["lists.levels.set", { levels: [{ level: 0, start: 0, restartAfter: 0 }] }],
  ["lists.levels.set", { levels: [{ level: 0, start: 0, restartAfter: 1 }, { level: 1, start: 0, restartAfter: 0 }] }],
  ["lists.levels.set", { levels: [{ level: 0, start: 0, restartAfter: 1 }, { level: 1, start: 0, restartAfter: 2 }, { level: 2, start: 0, restartAfter: 0 }] }],
  ["runs.fonts.set", { language: "" }],
  ["runs.set", { language: "en_US" }],
  ["runs.set", { language: "en--US" }],
  ["runs.set", { language: "en-a" }],
  ["runs.set", { language: "en-a-example-a-coastal" }],
  ["runs.set", { language: "sl-rozaj-rozaj" }],
  ["runs.set", { language: "KK" }],
])("rejects unsafe lengths and advanced formatting conflicts: %s", (operation, options) => {
  expect(() => validateDocxOptionRules(operation, options)).toThrow(DocxUsageError);
});

it.each([
  ["images.set", { x: { value: -0.5, unit: "emu" }, y: { value: Number.MIN_SAFE_INTEGER, unit: "emu" } }],
  ["images.add", { width: { value: 0.5, unit: "emu" } }],
  ["sections.columns.set", { equalWidth: true, columns: [{ width: { value: 1, unit: "in" } }, { width: { value: 72, unit: "pt" }, gapAfter: { value: 0, unit: "emu" } }] }],
  ["lists.levels.set", { levels: [{ level: 0, start: 0 }, { level: 1, start: 0, restartAfter: 0 }, { level: 2, start: 0, restartAfter: null }] }],
  ...["en-US", "zh-Hant-TW", "es-419", "de-DE-u-co-phonebk", "x-coastal", "i-klingon", "zh-cmn-Hans-CN"].map(language => ["runs.fonts.set", { language }]),
] as [string, Record<string, unknown>][]) ("accepts rounded safe geometry and explicit language tags: %s", (operation, options) => {
  expect(() => validateDocxOptionRules(operation, options)).not.toThrow();
});
