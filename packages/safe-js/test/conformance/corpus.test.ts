import { execFileSync } from "node:child_process";
import { vol } from "memfs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { runTest262Corpus, enumerateTest262, TEST262_REVISION } from "./corpus.js";

vi.mock("./isolate.js", async () => {
  const { executeTest262 } = await import("./execute.js");
  return { WORKER_STARTUP_TIMEOUT_MS: 10000, createTest262Executor: (options: { timeoutMs: number }) => ({
    execute: async (input: { filename: string; source: string; mode: "strict"; harness: Map<string, string> }) => {
      const result = await executeTest262(input.filename, input.source, { ...options, harness: input.harness, mode: input.mode });
      if (result.kind !== "test") throw new Error("Expected test variant");
      return result.results[0];
    },
    dispose: async () => undefined
  }) };
});
vi.mock("./provenance.js", async importOriginal => ({ ...await importOriginal<typeof import("./provenance.js")>(), sourceProvenance: vi.fn(async () => ({ sourceSha: "source", sourceHash: "hash", sourceHashes: {} })) }));
vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});
beforeEach(() => {
  vi.mocked(execFileSync).mockImplementation((_command, args) => args?.includes("rev-parse") ? TEST262_REVISION : "");
  vol.fromJSON({ "/corpus/harness/assert.js": "", "/corpus/harness/sta.js": "" });
});
afterEach(() => { vol.reset(); vi.clearAllMocks(); });

it("accounts for every selected source without treating fixtures or unsupported modes as passes", async () => {
  vol.fromJSON({
    "/corpus/test/pass.js": "1", "/corpus/test/fail.js": "throw 42",
    "/corpus/test/module.js": "/*---\nflags: [module]\n---*/\nexport {}",
    "/corpus/test/dep_FIXTURE.js": "export {}",
    "/corpus/test/invalid.js": "/*---\nflags: [unknown]\n---*/\n0"
  });
  const report = await runTest262Corpus({ corpus: "/corpus", timeoutMs: 1000 });
  expect(report).toMatchObject({ revision: TEST262_REVISION, execution: { timeoutMs: 1000, budget: {} },
    counts: { files: 5, fixtures: 1, metadataErrors: 1, executionErrors: 0, variants: 5, passed: 2, failed: 2, unsupported: 1 }
  });
  expect(report.entries.map(entry => entry.filename)).toEqual(["dep_FIXTURE.js", "fail.js", "invalid.js", "module.js", "pass.js"]);
});

it.each(["wrong-revision", "dirty"])("refuses unverified corpus state: %s", condition => {
  vi.mocked(execFileSync).mockImplementation((_command, args) => args?.includes("rev-parse")
    ? condition === "wrong-revision" ? "wrong" : TEST262_REVISION
    : " M test/example.js");
  return expect(runTest262Corpus({ corpus: "/corpus", timeoutMs: 1000 })).rejects.toThrow();
});

it("loads declared harness files and streams each result once", async () => {
  vol.fromJSON({ "/corpus/harness/extra.js": "let helper=7", "/corpus/test/example.js":
    '/*---\nincludes: [extra.js]\n---*/\nif(helper!==7)throw 1' });
  const entries: string[] = [];
  const report = await runTest262Corpus({ corpus: "/corpus", timeoutMs: 1000,
    onResult: entry => { entries.push(entry.filename); } });
  expect(report.counts.passed).toBe(2);
  expect(entries).toEqual(["example.js"]);
});

it("does not read harness paths outside the corpus harness directory", async () => {
  vol.fromJSON({ "/corpus/outside.js": "", "/corpus/test/example.js":
    '/*---\nincludes: [../outside.js]\n---*/\n0' });
  const report = await runTest262Corpus({ corpus: "/corpus", timeoutMs: 1000 });
  expect(report.counts).toMatchObject({ executionErrors: 1, passed: 0 });
});

it.each(["1", "/*---\nflags: [unknown]\n---*/\n0"])("does not retry or reclassify result-output failure for %s", async source => {
  vol.fromJSON({ "/corpus/test/example.js": source });
  const failure = new Error("report output failed");
  const onResult = vi.fn(() => { throw failure; });
  await expect(runTest262Corpus({ corpus: "/corpus", timeoutMs: 1000, onResult })).rejects.toBe(failure);
  expect(onResult).toHaveBeenCalledTimes(1);
});

it("rejects a corpus that changes during execution", async () => {
  vol.fromJSON({ "/corpus/test/example.js": "1" });
  let statusChecks = 0;
  vi.mocked(execFileSync).mockImplementation((_command, args) => {
    if (args?.includes("rev-parse")) return TEST262_REVISION;
    return ++statusChecks === 1 ? "" : " M test/example.js";
  });
  await expect(runTest262Corpus({ corpus: "/corpus", timeoutMs: 1000 })).rejects.toThrow("clean checkout");
});

it("enumerates all variants before bounded selection and records effective budgets", async () => {
  vol.fromJSON({ "/corpus/test/a.js": "1", "/corpus/test/b.js": "1" });
  const report = await runTest262Corpus({ corpus: "/corpus", timeoutMs: 1000, offset: 1, limit: 1 });
  expect(report.manifest.files).toHaveLength(2);
  expect(report.selected).toEqual(["b.js"]);
  expect(report.manifest.files[0].variants.map(variant => variant.mode)).toEqual(["sloppy", "strict"]);
  expect(report.execution.effectiveBudget.maxSteps).toBe("unlimited");
  expect(report.complete).toBe(true);
});

it("resumes bounded selections from a current manifest and rejects tampered or stale configuration", async () => {
  vol.fromJSON({ "/corpus/test/a.js": "1", "/corpus/test/b.js": "1" });
  const manifest = await enumerateTest262({ corpus: "/corpus", timeoutMs: 1000 });
  vol.fromJSON({ "/manifest.json": JSON.stringify(manifest) });
  const report = await runTest262Corpus({ corpus: "/corpus", manifest: "/manifest.json", timeoutMs: 1000, offset: 1, limit: 1 });
  expect(report.selected).toEqual(["b.js"]);
  await expect(runTest262Corpus({ corpus: "/corpus", manifest: "/manifest.json", timeoutMs: 2000 })).rejects.toThrow("Stale manifest");
  vol.fromJSON({ "/manifest.json": JSON.stringify({ ...manifest, id: "changed" }) });
  await expect(runTest262Corpus({ corpus: "/corpus", manifest: "/manifest.json", timeoutMs: 1000 })).rejects.toThrow("Invalid manifest digest");
});
