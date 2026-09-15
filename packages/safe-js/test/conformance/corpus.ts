import { execFileSync } from "node:child_process";
import { readFile, realpath, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { BudgetOptions } from "../../src/interp/budget.js";
import { discoverTest262 } from "./discover.js";
import type { executeTest262 } from "./execute.js";
import { prepareTest262 } from "./metadata.js";
import { sha256, sourceProvenance } from "./provenance.js";
import { countEntries, aggregateReports } from "./report.js";
import { createTest262Executor, WORKER_STARTUP_TIMEOUT_MS } from "./isolate.js";

export const TEST262_REVISION = "419d3e0a2273ba01a3bfcbec423f2801425b8e93";
export type CorpusEntry = { filename: string; sourceHash?: string } & (
  Awaited<ReturnType<typeof executeTest262>> |
  { kind: "metadata-error" | "execution-error"; message: string }
);

export type CorpusOptions = {
  corpus: string;
  manifest?: string;
  selections?: readonly string[];
  timeoutMs: number;
  budget?: BudgetOptions;
  offset?: number;
  limit?: number;
  onStart?: (manifest: Awaited<ReturnType<typeof enumerateTest262>>, selected: string[]) => void | Promise<void>;
  onResult?: (entry: CorpusEntry) => void | Promise<void>;
};

export function verifyCorpus(corpus: string) {
  const revision = execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["-C", corpus, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim();
  if (revision !== TEST262_REVISION || dirty !== "") throw new Error("Test262 corpus must be a clean checkout of the pinned revision");
}

export async function enumerateTest262(options: CorpusOptions) {
  verifyCorpus(options.corpus);
  const provenance = await sourceProvenance();
  const files = [];
  const fixtureAssets: Record<string, string> = {};
  for (const filename of await discoverTest262(options.corpus, ["."], true)) {
    const bytes = await readFile(join(options.corpus, "test", filename));
    const source = bytes.toString("utf8");
    const sourceHash = sha256(bytes);
    if (!filename.endsWith(".js")) { fixtureAssets[filename] = sourceHash; continue; }
    try {
      const prepared = prepareTest262(filename, source);
      files.push(prepared.kind === "fixture" ? { filename, sourceHash, kind: prepared.kind, variants: [] } : {
        filename, sourceHash, ...prepared, variants: prepared.variants.map(({ source: variantSource, ...variant }) => ({
          ...variant, id: `${filename}#${variant.mode}`, sourceHash: sha256(variantSource)
        }))
      });
    } catch (error) {
      files.push({ filename, sourceHash, kind: "metadata-error" as const, variants: [], message: String(error) });
    }
  }
  const harnessHashes: Record<string, string> = {};
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(join(options.corpus, "harness", directory), { withFileTypes: true })) {
      const name = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error("Harness provenance rejects symbolic links");
      if (entry.isDirectory()) await visit(name);
      else harnessHashes[name] = sha256(await readFile(join(options.corpus, "harness", name)));
    }
  };
  await visit("");
  const effectiveBudget = Object.fromEntries(["maxSteps", "maxCallDepth", "stringLength", "arrayLength", "dataSize"].map(name =>
    [name, options.budget?.[name as keyof BudgetOptions] ?? "unlimited"]));
  const data = { schemaVersion: 1, revision: TEST262_REVISION, ...provenance,
    runtime: { node: process.version, icu: process.versions.icu, v8: process.versions.v8, platform: process.platform, arch: process.arch },
    execution: { timeoutMs: options.timeoutMs, budget: { ...options.budget }, effectiveBudget, deadline: "per-variant timeout",
      isolation: { kind: "persistent-child-process", startupTimeoutMs: WORKER_STARTUP_TIMEOUT_MS, wallTimeoutMs: options.timeoutMs, timerStarts: "before-dispatch", recovery: "kill-and-replace-without-retrying-variant" } },
    files, fixtureAssets, harnessHashes: Object.fromEntries(Object.entries(harnessHashes).sort(([a], [b]) => a.localeCompare(b))) };
  verifyCorpus(options.corpus);
  const after = await sourceProvenance();
  if (after.sourceHash !== provenance.sourceHash || after.sourceSha !== provenance.sourceSha) throw new Error("Runner sources changed during enumeration");
  return { id: sha256(JSON.stringify(data)), ...data };
}

export async function runTest262Corpus(options: CorpusOptions) {
  let manifest: Awaited<ReturnType<typeof enumerateTest262>>;
  if (options.manifest) {
    manifest = JSON.parse(await readFile(options.manifest, "utf8"));
    const { id, ...data } = manifest;
    if (sha256(JSON.stringify(data)) !== id) throw new Error("Invalid manifest digest");
    verifyCorpus(options.corpus);
    const current = await sourceProvenance();
    if (current.sourceHash !== manifest.sourceHash || current.sourceSha !== manifest.sourceSha ||
        manifest.revision !== TEST262_REVISION || manifest.runtime.node !== process.version ||
        manifest.runtime.icu !== process.versions.icu || manifest.runtime.v8 !== process.versions.v8 ||
        manifest.runtime.platform !== process.platform || manifest.runtime.arch !== process.arch ||
        manifest.execution.timeoutMs !== options.timeoutMs || JSON.stringify(manifest.execution.budget) !== JSON.stringify(options.budget ?? {}))
      throw new Error("Stale manifest: source, runtime or execution configuration differs");
  } else manifest = await enumerateTest262(options);
  const candidates = options.selections ? await discoverTest262(options.corpus, options.selections) : manifest.files.map(file => file.filename);
  const offset = options.offset ?? 0;
  const limit = options.limit ?? candidates.length;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit <= 0 || offset >= candidates.length)
    throw new Error("Invalid or empty bounded selection");
  const files = candidates.slice(offset, offset + limit);
  await options.onStart?.(manifest, files);
  const harnessRoot = await realpath(join(options.corpus, "harness"));
  const harness = new Map<string, string>();
  const entries: CorpusEntry[] = [];
  const indexedFiles = new Map(manifest.files.map(file => [file.filename, file]));
  const executor = createTest262Executor({ timeoutMs: options.timeoutMs, budget: options.budget });
  try {
  for (const filename of files) {
    let entry: CorpusEntry;
    let sourceHash: string | undefined;
    let phase: "metadata" | "execution" = "execution";
    try {
      const bytes = await readFile(join(options.corpus, "test", filename));
      const source = bytes.toString("utf8");
      sourceHash = sha256(bytes);
      if (sourceHash !== indexedFiles.get(filename)?.sourceHash) throw new Error("Source differs from manifest");
      phase = "metadata";
      const prepared = prepareTest262(filename, source);
      phase = "execution";
      if (prepared.kind === "test") {
        for (const name of new Set(prepared.variants.flatMap(variant => variant.harness))) {
          if (harness.has(name)) continue;
          const path = resolve(harnessRoot, name);
          if (isAbsolute(name) || relative(harnessRoot, path).split(sep)[0] === "..")
            throw new Error("Test262 harness include escapes the harness directory");
          const canonical = await realpath(path);
          if (relative(harnessRoot, canonical).split(sep)[0] === "..")
            throw new Error("Test262 harness include resolves outside the harness directory");
          const harnessSource = await readFile(canonical, "utf8");
          if (sha256(harnessSource) !== manifest.harnessHashes[name]) throw new Error("Harness differs from manifest");
          harness.set(name, harnessSource);
        }
      }
      if (prepared.kind === "fixture") entry = { filename, sourceHash, kind: "fixture" };
      else {
        const results = [];
        for (const variant of prepared.variants) results.push(await executor.execute({ filename, source, mode: variant.mode, harness }));
        entry = { filename, sourceHash, kind: "test", results };
      }
    } catch (error) {
      entry = { filename, sourceHash, kind: phase === "metadata" ? "metadata-error" : "execution-error",
        message: error instanceof Error ? error.message : String(error) };
    }
    entries.push(entry);
    await options.onResult?.(entry);
  }
  } finally { await executor.dispose(); }
  verifyCorpus(options.corpus);
  const after = await sourceProvenance();
  if (after.sourceHash !== manifest.sourceHash || after.sourceSha !== manifest.sourceSha) throw new Error("Runner sources changed during execution");
  const report = { complete: true, manifestId: manifest.id, manifest, selected: files,
    revision: TEST262_REVISION, runtime: manifest.runtime, execution: manifest.execution,
    selections: options.selections ?? ["."], counts: countEntries(entries), entries,
    harnessHashes: manifest.harnessHashes };
  const selected = new Set(files);
  aggregateReports({ ...manifest, files: manifest.files.filter(file => selected.has(file.filename)) }, [report]);
  return report;
}
