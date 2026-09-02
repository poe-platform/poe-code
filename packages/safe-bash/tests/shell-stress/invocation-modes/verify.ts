import { mkdtemp, readFile, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { boundedProcess, head, immutableJson, owned, sanitizedEnv, sourceHashes } from "./harness.js";

const name = process.argv[2] ?? "verification-evidence.json";
const stage = process.argv[3] ?? "holdouts";
const ready = stage === "baseline" ? "NOT READY: preparatory baseline only" : await readFile("/tmp/safe-bash-shell-invocation-ready.txt", "utf8");
const temporary = await mkdtemp(resolve(owned, ".verify-"));
const trace = `${temporary}/imports.log`;
const before = await sourceHashes();
const beforeHead = head();
const commands: Record<string, string[][]> = {
  baseline: ["bash-c-literal-args-0", "bash-read-same-chunk", "path-first-usable"].map(id => ["--unhandled-rejections=strict", "--import", "tsx", "--import", `./${owned}/trace.mjs`, `${owned}/virtual-child.ts`, id]),
  holdouts: [["--unhandled-rejections=strict", "--import", "tsx", "--test", `${owned}/holdout.test.ts`]],
  regression: [
    ["--unhandled-rejections=strict", "--import", "tsx", "--import", `./${owned}/trace.mjs`, "--test", "tests/shell/invocation-modes.test.ts"],
    ["--unhandled-rejections=strict", "--import", "tsx", "--import", `./${owned}/trace.mjs`, "--test", "tests/shell/script-entrypoint.test.ts", "tests/shell-stress/script-entrypoint/holdout.test.ts"],
    ["--unhandled-rejections=strict", "--import", "tsx", "--import", `./${owned}/trace.mjs`, "--test", "tests/shell/core.cases.ts", "tests/shell/invoke.test.ts", "tests/shell/stdin-origin.test.ts", "tests/shell/input-units.test.ts", "tests/shell/descriptor-inheritance.test.ts", "tests/shell/glob-budget.cases.ts", "tests/shell/inline-input-limits.test.ts"],
    ["node_modules/typescript/bin/tsc", "--noEmit"],
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json", "--noEmit"],
  ],
};
try {
  if (!commands[stage]) throw new Error(`Unknown stage ${stage}`);
  const runs = [];
  for (const args of commands[stage]) {
    const env = { ...sanitizedEnv(), PATH: "/usr/bin:/bin", INVOCATION_TRACE: trace };
    const result = await boundedProcess(process.execPath, args, { cwd: process.cwd(), env, deadlineMs: 120000 });
    runs.push(result);
    console.log(`${args.join(" ")}: ${result.code}, timeout=${result.timedOut}`);
  }
  const after = await sourceHashes();
  const imports = [...new Set((await readFile(trace, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(path => relative(process.cwd(), path)))].sort();
  const changedImported = imports.filter(path => before[path] !== after[path] || !before[path]);
  const changedAll = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]);
  const evidence = { timestamp: new Date().toISOString(), ready, stage, beforeHead, afterHead: head(),
    importedSource: Object.fromEntries(imports.map(path => [path, { before: before[path], after: after[path] }])),
    changedImported, changedAll, imports, runs };
  await immutableJson(name, evidence);
  if (changedImported.length || !imports.some(path => path === "src/shell/runtime.ts") || imports.some(path => path.endsWith(".js")) || runs.some(run => run.code !== 0 || run.timedOut || run.overflow)) process.exitCode = 1;
} finally { await rm(temporary, { recursive: true, force: true }); }
