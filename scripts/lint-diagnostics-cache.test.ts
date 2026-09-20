import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { createCheckCache } from "./check-cache.mjs";
import { createLintDiagnosticsCache } from "./lint-diagnostics-cache.mjs";
import { lintRoot, model, root } from "./lint-eslint.fixtures.js";

function fixture() {
  const fileSystem = createFsFromVolume(new Volume());
  const store = createCheckCache({ directory: "/cache", fileSystem });
  const subject = { filename: "/repo/src/unit.ts", bytes: Buffer.from("export const value = 1;"), configuration: { rules: { "no-debugger": [2] } } };
  const result = { filePath: subject.filename, messages: [], errorCount: 0, warningCount: 0, fatalErrorCount: 0 };
  return { store, subject, result, cache: createLintDiagnosticsCache({ root: "/repo", store, salt: "tool-versions" }) };
}

describe("guarded lint diagnostic caching", () => {
  it("keeps every guard read and receipt check on a warm run and rejects changed source", async () => {
    const fileSystem = createFsFromVolume(new Volume());
    const diagnosticsCache = createLintDiagnosticsCache({ root, salt: "tools", store: createCheckCache({ directory: "/cache", fileSystem }) });
    const first = model({ "src/unit.js": "export const value = 1;" });
    const cold = await lintRoot({ guard: first.guard, config: first.config, receiptBinding: first.binding, diagnosticsCache });
    const second = model({ "src/unit.js": "export const value = 1;" });
    const warm = await lintRoot({ guard: second.guard, config: second.config, receiptBinding: second.binding, diagnosticsCache });
    expect(warm).toMatchObject({ complete: true, exitCode: 0 });
    expect(warm.cacheHits).toBeGreaterThan(0);
    expect(warm.counters).toEqual(cold.counters);
    expect(second.operations).toEqual(first.operations);
    const changed = model({ "src/unit.js": "unknownBinding();" });
    expect(await lintRoot({ guard: changed.guard, config: changed.config, receiptBinding: changed.binding, diagnosticsCache })).toMatchObject({ exitCode: 1 });
  });

  it("reuses clean diagnostics across checkout paths and invalidates source, rules and tool versions", () => {
    const { store, subject, result, cache } = fixture();
    expect(cache.read(subject)).toBeNull();
    cache.save(subject, result);
    expect(cache.read(subject)).toEqual(result);
    const other = createLintDiagnosticsCache({ root: "/other", store, salt: "tool-versions" });
    expect(other.read({ ...subject, filename: "/other/src/unit.ts" })).toEqual({ ...result, filePath: "/other/src/unit.ts" });
    expect(cache.read({ ...subject, bytes: Buffer.from("debugger;") })).toBeNull();
    expect(cache.read({ ...subject, configuration: { rules: { "no-debugger": [0] } } })).toBeNull();
    expect(createLintDiagnosticsCache({ root: "/repo", store, salt: "new-tools" }).read(subject)).toBeNull();
  });

  it("runs processors and type-aware rules fresh and never caches errors or warnings", () => {
    const { subject, result, cache } = fixture();
    for (const configuration of [{ ...subject.configuration, processor: {} }, { languageOptions: { parserOptions: { projectService: true } } }]) {
      const special = { ...subject, configuration };
      cache.save(special, result);
      expect(cache.read(special)).toBeNull();
    }
    cache.save(subject, { ...result, errorCount: 1 });
    expect(cache.read(subject)).toBeNull();
    cache.save(subject, { ...result, warningCount: 1 });
    expect(cache.read(subject)).toBeNull();
  });
});
