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
  it("captures a configured metadata cap in inventory phase and clears a fresh initialization", async () => {
    const state = bootstrapModel("opens");
    const metadataCap = 10000;
    expect(guardedInputs.LIMITS.metadataOperations).toBe(8000000);
    const options = { ...state.options, limits: { metadataOperations: metadataCap }, lintExclusions(_root: string, _boundaries: unknown, fileSystem: any) {
      // This control exhausts guard accounting against an unchanged root; metadata
      // mutation is covered separately. Keep immutable root observations constant.
      const memory = state.fileSystem;
      const { lstatSync, readdirSync, realpathSync } = memory;
      const parent = lstatSync("/"), directory = lstatSync(root);
      const names = readdirSync("/", { encoding: "buffer" });
      memory.lstatSync = ((path: string) => path === "/" ? parent : path === root ? directory : lstatSync(path)) as typeof lstatSync;
      memory.readdirSync = ((path: string, options?: any) => path === "/" && options?.encoding === "buffer" ? names : readdirSync(path, options)) as typeof readdirSync;
      memory.realpathSync = ((path: string) => path === root ? root : realpathSync(path)) as typeof realpathSync;
      try {
        for (let attempt = 0; attempt <= metadataCap; attempt++) fileSystem.lstatSync(root);
      } finally {
        Object.assign(memory, { lstatSync, readdirSync, realpathSync });
      }
      return { files: [], directories: [] };
    } };
    await guardedInputs.withLintFailureDiagnostics(async (diagnostics: any) => {
      await expect(guardedInputs.initializeLintConfiguration(options)).rejects.toMatchObject({ code: "LINT_LIMIT", message: "metadata operation cap" });
      const failure = diagnostics();
      expect(failure).toMatchObject({ phase: "inventory-provenance", root, counters: { metadataOperations: metadataCap, failed: true, reading: false, receiptChecks: 50, subjects: 0, lastMetadata: { admitted: false, completed: false } } });
      expect(failure.counters.opens).toBe(failure.counters.closes);
      expect(failure.counters.lastMetadata.path).toBeTypeOf("string");
      expect(receiptPayloads(state)).toEqual([]);
      console.log(JSON.stringify({ control: "initialization-cap-diagnostics", failure }));
      const fresh = bootstrapModel();
      await guardedInputs.initializeLintConfiguration(fresh.options);
      expect(diagnostics()).toBeNull();
      expect(failure.counters.metadataOperations).toBe(metadataCap);
    });
  }, 180000);
});

describe("owned directory operation and exact root receipt", () => {
  it("completes an owned mixed traversal under the authorized eight-million metadata cap", async () => {
    const files: Record<string, string> = {};
    const parents = Array.from({ length: 8 }, (_, index) => "depth-" + index).join("/");
    for (let group = 0; group < 8; group++) {
      for (let member = 0; member < 32; member++) files[parents + "/group-" + group + "/member-" + member + (member % 16 === 0 ? ".mjs" : ".data")] = member % 16 === 0 ? "export const value = 1;" : "owned noncode";
    }
    const state = model(files, "opens");
    // This fixture never mutates: avoid repeating memfs ancestor walks while the
    // guard still accounts for every metadata operation at the full scale.
    for (const method of ["lstatSync", "realpathSync", "readdirSync"] as const) {
      const read = state.fileSystem[method] as (...args: unknown[]) => unknown;
      const values = new Map<string, unknown>();
      Object.defineProperty(state.fileSystem, method, { value(...args: unknown[]) {
        const key = JSON.stringify(args);
        let value = values.get(key);
        if (value === undefined) {
          value = read(...args);
          values.set(key, value);
        }
        return value;
      } });
    }
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: state.binding });
    expect(result.complete).toBe(true);
    expect(result.scope.linted).toBe(21);
    expect(result.scope.unconfigured).toBe(245);
    expect(result.counters.metadataOperations).toBeGreaterThan(Object.keys(files).length);
    expect(result.counters.metadataOperations).toBeLessThan(8000000);
    expect(result.counters.opens).toBe(result.counters.closes);
    expect(receiptPayloads(state)).toEqual([]);
    console.log(JSON.stringify({ control: "owned-directory-mixed-256", scope: result.scope, counters: result.counters, receipts: result.receipts.length, unprocessed: result.unprocessed }));
  }, 180000);
});
