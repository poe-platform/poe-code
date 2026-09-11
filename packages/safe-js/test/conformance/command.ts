import { open } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type { BudgetOptions } from "../../src/interp/budget.js";
import { runTest262Corpus, TEST262_REVISION } from "./corpus.js";

export async function runConformanceCommand(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: {
    corpus: { type: "string" }, report: { type: "string" },
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
  const output = await open(values.report, "ax");
  try {
    await output.appendFile(JSON.stringify({ type: "header", revision: TEST262_REVISION,
      corpus: values.corpus, selections: values.include ?? ["."], timeoutMs, budget,
      runtime: { node: process.version, icu: process.versions.icu } }) + "\n");
    const report = await runTest262Corpus({ corpus: values.corpus, selections: values.include, timeoutMs, budget,
      onResult: async entry => { await output.appendFile(JSON.stringify({ type: "result", ...entry }) + "\n"); }
    });
    await output.appendFile(JSON.stringify({ type: "summary", ...report, entries: undefined }) + "\n");
    const counts = report.counts;
    return counts.variants > 0 && counts.passed === counts.variants && counts.metadataErrors === 0 && counts.executionErrors === 0 ? 0 : 1;
  } finally { await output.close(); }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runConformanceCommand(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
