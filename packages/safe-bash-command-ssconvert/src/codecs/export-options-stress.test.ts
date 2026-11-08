import { expect, it } from "vitest";
import { createRegistry } from "./registry.js";
import { applyExportOption } from "./export-options.js";
import type { ExportOptionRule } from "./types.js";

it("owns declarative rule maps and enum arrays at registration", () => {
  const values = ["first"];
  const rules: Record<string, ExportOptionRule> = { mode: { kind: "enum", values } };
  const registry = createRegistry([{ id: "custom", description: "Custom", extensions: [],
    exportOptionRules: rules, async write() { return new Uint8Array(); } }]);
  const codec = registry.select("write", "custom")!;
  values.push("second");
  rules.mode = { kind: "string" };
  expect(() => applyExportOption(codec.exportOptionRules!.mode!, "mode", "second"))
    .toThrow('Invalid value for option mode: "second"');
});

it("folds enum values with ASCII semantics only", () => {
  const rule: ExportOptionRule = { kind: "enum", values: ["yes", "k"], asciiCaseInsensitive: true };
  expect(() => applyExportOption(rule, "mode", "YES")).not.toThrow();
  expect(() => applyExportOption(rule, "mode", "\u212a")).toThrow("Invalid value");
});

it("keeps enum-owned diagnostics rather than replacing them", () => {
  expect(() => applyExportOption({ kind: "enum", values: ["valid"], error: "provider failure" }, "mode", "invalid"))
    .toThrow("ssconvert: provider failure");
});
