import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { boundedProcess, head, immutableJson, owned, sanitizedEnv, sha256, sourceHashes } from "./harness.js";

const sourceCommit = "21a6b9149e3a0e35e14f1c740860971f08053686";
const temporary = await mkdtemp(resolve(owned, ".supplement-"));
const trace = `${temporary}/imports.log`;
const before = await sourceHashes();
const beforeHead = head();
const commands = [
  ["--unhandled-rejections=strict", "--import", "tsx", "--import", `./${owned}/trace.mjs`, `${owned}/compare-frozen.ts`],
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json", "--noEmit"],
];
try {
  const runs = [];
  for (const args of commands) {
    const result = await boundedProcess(process.execPath, args, { cwd: process.cwd(), env: { ...sanitizedEnv(), INVOCATION_TRACE: trace }, deadlineMs: 30000 });
    runs.push(result);
    console.log(`${args.join(" ")}: ${result.code}; ${result.stdout.trim()}`);
  }
  const after = await sourceHashes();
  const imports = [...new Set((await readFile(trace, "utf8")).trim().split("\n").filter(Boolean).map(path => relative(process.cwd(), path)))].sort();
  const importedSource = Object.fromEntries(imports.map(path => [path, { before: before[path], after: after[path], frozen: sha256(execFileSync("git", ["show", `${sourceCommit}:${path}`])) }]));
  const changedImported = Object.entries(importedSource).filter(([, hashes]) => hashes.before !== hashes.after || hashes.after !== hashes.frozen).map(([path]) => path);
  const changedAll = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]);
  const evidence = { timestamp: new Date().toISOString(), sourceCommit, beforeHead, afterHead: head(), importedSource, changedImported, changedAll, imports, runs };
  await immutableJson(process.argv[2] ?? "post-ready-supplement-evidence.json", evidence);
  assert.deepEqual(changedImported, []);
  assert.deepEqual(changedAll, []);
  assert.ok(imports.includes("src/shell/runtime.ts"));
  assert.ok(imports.every(path => path.endsWith(".ts")));
  assert.ok(runs.every(run => !run.timedOut && !run.overflow && run.signal === null));
  assert.ok(runs.slice(1).every(run => run.code === 0));
  if (runs[0]!.code !== 0) process.exitCode = 1;
} finally { await rm(temporary, { recursive: true, force: true }); }
