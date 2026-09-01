import { describe, expect, it } from "vitest";
import {
  bootstrapModel,
  guardedInputs,
  lintRoot,
  model,
  receiptPayloads,
  root
} from "./lint-eslint.fixtures.js";

describe("guarded configuration bootstrap ordering", () => {
  it("captures the actual metadata cap in inventory phase and clears a fresh initialization", async () => {
    const state = bootstrapModel("opens");
    const options = { ...state.options, lintExclusions(_root: string, _boundaries: unknown, fileSystem: any) {
      for (let attempt = 0; attempt < 8000001; attempt++) fileSystem.lstatSync(root + "/src/ordinary.js");
      return { files: [], directories: [] };
    } };
    await guardedInputs.withLintFailureDiagnostics(async (diagnostics: any) => {
      await expect(guardedInputs.initializeLintConfiguration(options)).rejects.toMatchObject({ code: "LINT_LIMIT", message: "metadata operation cap" });
      const failure = diagnostics();
      expect(failure).toMatchObject({ phase: "inventory-provenance", root, counters: { metadataOperations: 8000000, failed: true, reading: false, receiptChecks: 50, subjects: 0, lastMetadata: { admitted: false, completed: false } } });
      expect(failure.counters.opens).toBe(failure.counters.closes);
      expect(failure.counters.lastMetadata.path).toBeTypeOf("string");
      expect(receiptPayloads(state)).toEqual([]);
      console.log(JSON.stringify({ control: "initialization-cap-diagnostics", failure }));
      const fresh = bootstrapModel();
      await guardedInputs.initializeLintConfiguration(fresh.options);
      expect(diagnostics()).toBeNull();
      expect(failure.counters.metadataOperations).toBe(8000000);
    });
  }, 180000);
});

describe("owned directory operation and exact root receipt", () => {
  it("completes an owned mixed traversal under the authorized eight-million metadata cap", async () => {
    const files: Record<string, string> = {};
    const parents = Array.from({ length: 19 }, (_, index) => "depth-" + index).join("/");
    for (let group = 0; group < 64; group++) {
      for (let member = 0; member < 256; member++) files[parents + "/group-" + group + "/member-" + member + (member % 16 === 0 ? ".mjs" : ".data")] = member % 16 === 0 ? "export const value = 1;" : "owned noncode";
    }
    const state = model(files, "opens");
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: state.binding });
    expect(result.complete).toBe(true);
    expect(result.scope.linted).toBe(1029);
    expect(result.scope.unconfigured).toBe(15365);
    expect(result.counters.metadataOperations).toBe(1209401);
    expect(result.counters.metadataOperations).toBeLessThan(8000000);
    expect(result.counters.opens).toBe(result.counters.closes);
    expect(receiptPayloads(state)).toEqual([]);
    console.log(JSON.stringify({ control: "owned-directory-scale-16384", scope: result.scope, counters: result.counters, receipts: result.receipts.length, unprocessed: result.unprocessed }));
  }, 180000);
});
