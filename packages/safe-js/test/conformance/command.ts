import { open, readFile } from "node:fs/promises";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type { BudgetOptions } from "../../src/interp/budget.js";
import { runTest262Corpus, enumerateTest262, type CorpusEntry } from "./corpus.js";
import { aggregateReports, type SelectionReport } from "./report.js";

export async function runConformanceCommand(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: {
    corpus: { type: "string" }, report: { type: "string" },
    manifest: { type: "string" }, enumerate: { type: "boolean" }, aggregate: { type: "string", multiple: true },
    offset: { type: "string" }, limit: { type: "string" },
    include: { type: "string", multiple: true }, "timeout-ms": { type: "string", default: "3000" },
    "max-steps": { type: "string" }, "max-call-depth": { type: "string" },
    "string-length": { type: "string" }, "array-length": { type: "string" }, "data-size": { type: "string" }
  } });
  const timeoutMs = Number(values["timeout-ms"]);
  if (!values.corpus || !values.report || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error("Required: --corpus <checkout> --report <new.jsonl> [--include <test-path>] [--timeout-ms <positive integer>]");
  const budget: BudgetOptions = {};
  const budgetFlags = { "max-steps": "maxSteps", "max-call-depth": "maxCallDepth",
    "string-length": "stringLength", "array-length": "arrayLength", "data-size": "dataSize" } as const;
  for (const flag of Object.keys(budgetFlags) as Array<keyof typeof budgetFlags>) {
    const value = values[flag];
    if (value === undefined) continue;
    const limit = Number(value);
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error(`--${flag} requires a positive finite integer`);
    budget[budgetFlags[flag]] = limit;
  }
  const offset = values.offset === undefined ? undefined : Number(values.offset);
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0) ||
      limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) throw new Error("Invalid --offset or --limit");
  if ((values.enumerate || values.aggregate) && (values.include || offset !== undefined || limit !== undefined))
    throw new Error("Enumeration and aggregation require the complete corpus");
  if (values.enumerate && values.aggregate) throw new Error("Choose enumeration or aggregation");
  const options = { corpus: values.corpus, manifest: values.manifest, selections: values.include, timeoutMs, budget, offset, limit };
  const output = await open(values.report, "ax");
  try {
    if (values.enumerate || values.aggregate) {
      const manifest = await enumerateTest262(options);
      if (values.enumerate) {
        await output.appendFile(JSON.stringify(manifest) + "\n");
        return 0;
      }
      const reports: SelectionReport[] = [];
      for (const path of values.aggregate!) {
        const records = (await readFile(path, "utf8")).trim().split("\n").map(line => JSON.parse(line));
        const header = records[0];
        const summary = records.at(-1);
        if (header?.type !== "header" || summary?.type !== "summary" || summary.complete !== true ||
            header.manifestId !== summary.manifestId || JSON.stringify(header.selected) !== JSON.stringify(summary.selected) ||
            records.slice(1, -1).some(record => record.type !== "result")) throw new Error(`Incomplete or malformed report: ${path}`);
        for (const key of ["revision", "sourceSha", "sourceHash", "runtime", "execution"] as const) {
          if (JSON.stringify(header[key]) !== JSON.stringify(manifest[key])) throw new Error(`Header provenance mismatch: ${key}`);
        }
        if (JSON.stringify(summary.runtime) !== JSON.stringify(manifest.runtime) ||
            JSON.stringify(summary.execution) !== JSON.stringify(manifest.execution) || summary.revision !== manifest.revision)
          throw new Error("Summary provenance mismatch");
        reports.push({ ...summary, entries: records.slice(1, -1) });
      }
      const aggregate = aggregateReports(manifest, reports);
      await output.appendFile(JSON.stringify({ type: "summary", ...aggregate, manifest, reports: values.aggregate }) + "\n");
      return aggregate.success ? 0 : 1;
    }
    let started: { manifest: Awaited<ReturnType<typeof enumerateTest262>>; selected: string[] } | undefined;
    const streamed: CorpusEntry[] = [];
    const report = await runTest262Corpus({ ...options,
      onStart: async (manifest, selected) => {
        if (started) throw new Error("Duplicate report header");
        started = { manifest: structuredClone(manifest), selected: [...selected] };
        await output.appendFile(JSON.stringify({ type: "header", manifestId: manifest.id,
          revision: manifest.revision, sourceSha: manifest.sourceSha, sourceHash: manifest.sourceHash,
          runtime: manifest.runtime, execution: manifest.execution, selected, command: args,
          startedAt: new Date().toISOString() }) + "\n");
      },
      onResult: async entry => {
        if (!started) throw new Error("Result precedes report header");
        streamed.push(structuredClone(entry));
        await output.appendFile(JSON.stringify({ type: "result", ...entry }) + "\n");
      }
    });
    if (report.complete !== true || !started || started.manifest.id !== report.manifestId ||
        !isDeepStrictEqual(started.manifest, report.manifest) || !isDeepStrictEqual(started.selected, report.selected) ||
        !isDeepStrictEqual(streamed, report.entries))
      throw new Error("Report stream differs from completed execution");
    const selected = new Set(started.selected);
    aggregateReports({ ...started.manifest, files: started.manifest.files.filter(file => selected.has(file.filename)) }, [report]);
    await output.appendFile(JSON.stringify({ type: "summary", ...report, entries: undefined, manifest: undefined,
      completedAt: new Date().toISOString() }) + "\n");
    const counts = report.counts;
    return counts.variants > 0 && counts.passed === counts.variants && counts.metadataErrors === 0 && counts.executionErrors === 0 ? 0 : 1;
  } catch (error) {
    await output.appendFile(JSON.stringify({ type: "aborted", complete: false, message: error instanceof Error ? error.message : String(error) }) + "\n");
    throw error;
  } finally { await output.close(); }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runConformanceCommand(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
