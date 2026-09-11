import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { BudgetOptions } from "../../src/interp/budget.js";
import { discoverTest262 } from "./discover.js";
import { executeTest262 } from "./execute.js";
import { prepareTest262 } from "./metadata.js";

export const TEST262_REVISION = "419d3e0a2273ba01a3bfcbec423f2801425b8e93";
export type CorpusEntry = { filename: string; sourceHash?: string } & (
  Awaited<ReturnType<typeof executeTest262>> |
  { kind: "metadata-error" | "execution-error"; message: string }
);

export async function runTest262Corpus(options: {
  corpus: string;
  selections?: readonly string[];
  timeoutMs: number;
  budget?: BudgetOptions;
  onResult?: (entry: CorpusEntry) => void | Promise<void>;
}) {
  const verify = () => {
    const revision = execFileSync("git", ["-C", options.corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["-C", options.corpus, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim();
    if (revision !== TEST262_REVISION || dirty !== "") throw new Error("Test262 corpus must be a clean checkout of the pinned revision");
  };
  verify();
  const files = await discoverTest262(options.corpus, options.selections);
  const harnessRoot = await realpath(join(options.corpus, "harness"));
  const harness = new Map<string, string>();
  const entries: CorpusEntry[] = [];
  const counts = { files: files.length, fixtures: 0, metadataErrors: 0, executionErrors: 0,
    variants: 0, passed: 0, failed: 0, unsupported: 0 };
  for (const filename of files) {
    let entry: CorpusEntry;
    let sourceHash: string | undefined;
    let phase: "metadata" | "execution" = "execution";
    try {
      const source = await readFile(join(options.corpus, "test", filename), "utf8");
      sourceHash = createHash("sha256").update(source).digest("hex");
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
          harness.set(name, await readFile(canonical, "utf8"));
        }
      }
      entry = { filename, sourceHash, ...await executeTest262(filename, source, {
        harness, timeoutMs: options.timeoutMs, budget: options.budget
      }) };
      if (entry.kind === "fixture") counts.fixtures++;
      else if (entry.kind === "test") {
        counts.variants += entry.results.length;
        for (const result of entry.results) counts[result.status]++;
      }
    } catch (error) {
      entry = { filename, sourceHash, kind: phase === "metadata" ? "metadata-error" : "execution-error",
        message: error instanceof Error ? error.message : String(error) };
      if (phase === "metadata") counts.metadataErrors++;
      else counts.executionErrors++;
    }
    entries.push(entry);
    await options.onResult?.(entry);
  }
  verify();
  return { revision: TEST262_REVISION, runtime: { node: process.version, icu: process.versions.icu },
    execution: { timeoutMs: options.timeoutMs, budget: { ...options.budget } },
    selections: options.selections ?? ["."], counts, entries,
    harnessHashes: Object.fromEntries([...harness].map(([name, source]) => [name, createHash("sha256").update(source).digest("hex")])) };
}
