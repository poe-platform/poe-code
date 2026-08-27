import { mkdtemp, readFile, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { boundedProcess, head, owned, save, sha256, sourceHashes } from "./support.js";

const name = process.argv[2] ?? "verification.json";
const stage = process.argv[3] ?? "new";
const ready = stage === "prepare" ? "PREPARATION ONLY, no source acceptance" : await readFile("/tmp/safe-bash-shell-invocation-closure-ready.txt", "utf8");
const temporary = await mkdtemp(resolve(owned, ".verify-"));
const hook = ["--unhandled-rejections=strict", "--import", "tsx", "--import", "./tests/shell-stress/invocation-modes/trace.mjs"];
const strict = ["node_modules/typescript/bin/tsc", "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck"];
const commands: Record<string, { args: string[]; types?: boolean; label: string }[]> = {
  prepare: [{ label: "owned preparation types", types: true, args: [...strict, ...["support", "cases", "native", "probe", "holdout.test", "verify", "compare"].map(path => `${owned}/${path}.ts`)] }],
  new: [{ label: "new 34 holdouts", args: [...hook, "--test", `${owned}/holdout.test.ts`] }],
  legacy: [
    { label: "unchanged 72", args: [...hook, "--test", "tests/shell-stress/invocation-modes/holdout.test.ts"] },
    { label: "unchanged 132", args: [...hook, "--test", "tests/shell/invocation-modes.test.ts"] },
  ],
  previous: [
    { label: "previous file 58", args: [...hook, "--test", "tests/shell/script-entrypoint.test.ts", "tests/shell-stress/script-entrypoint/holdout.test.ts"] },
    { label: "selected regressions", args: [...hook, "--test", ...["core", "invoke", "stdin-origin", "input-units", "descriptor-inheritance", "glob-budget", "inline-input-limits", "read-options", "read-fields", "variable-scope"].map(path => `tests/shell/${path}.test.ts`)] },
  ],
  types: [
    { label: "global noEmit", types: true, args: ["node_modules/typescript/bin/tsc", "--noEmit"] },
    { label: "build noEmit", types: true, args: ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json", "--noEmit"] },
    { label: "shell benchmark types", types: true, args: [...strict, "benchmarks/shell-stress/diagnostic-profiles/run.ts"] },
  ],
};
if (!commands[stage]) throw new Error(`Unknown verification stage ${stage}`);
const records = [];
try {
  for (const [index, command] of commands[stage].entries()) {
    const trace = `${temporary}/imports-${index}.log`;
    const observationPath = `${temporary}/observations-${index}.jsonl`;
    const beforeHead = head();
    const sourceBefore = await sourceHashes();
    const env = { PATH: "/usr/bin:/bin", HOME: "/nonexistent", LANG: "C", LC_ALL: "C", TZ: "UTC", INVOCATION_TRACE: trace, CLOSURE_OBSERVATIONS: observationPath };
    const compilerPaths = (output: string): string[] => [...new Set(output.split("\n").filter(line => line.startsWith("/") && /\.(?:ts|mts|cts|tsx)$/u.test(line)).map(path => relative(process.cwd(), path)))].sort();
    const startingList = command.types ? await boundedProcess(process.execPath, [...command.args, "--listFilesOnly"], { cwd: process.cwd(), env, deadlineMs: 60000 }) : undefined;
    const inputsBefore: Record<string, string> = {};
    if (startingList) for (const path of compilerPaths(startingList.stdout)) inputsBefore[path] = sha256(await readFile(path));
    const configBefore = Object.fromEntries(await Promise.all(["tsconfig.json", "tsconfig.build.json"].map(async path => [path, sha256(await readFile(path))])));
    const run = await boundedProcess(process.execPath, [...command.args, ...(command.types ? ["--listFiles"] : [])], { cwd: process.cwd(), env, deadlineMs: 120000 });
    const sourceAfter = await sourceHashes();
    const imports = command.types ? compilerPaths(run.stdout) : [...new Set((await readFile(trace, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(path => relative(process.cwd(), path)))].sort();
    const importedSource: Record<string, { before: string | null; after: string | null }> = {};
    for (const path of imports) importedSource[path] = { before: (command.types ? inputsBefore[path] : sourceBefore[path]) ?? null, after: command.types ? sha256(await readFile(path)) : sourceAfter[path] ?? null };
    const changedRelevant = Object.entries(importedSource).filter(([, hashes]) => hashes.before === null || hashes.before !== hashes.after).map(([path]) => path);
    const configAfter = Object.fromEntries(await Promise.all(["tsconfig.json", "tsconfig.build.json"].map(async path => [path, sha256(await readFile(path))])));
    if (command.types) for (const path of Object.keys(configBefore)) if (configBefore[path] !== configAfter[path]) changedRelevant.push(path);
    const allSourceChanges = [...new Set([...Object.keys(sourceBefore), ...Object.keys(sourceAfter)])].filter(path => sourceBefore[path] !== sourceAfter[path]);
    const observations = (await readFile(observationPath, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as unknown);
    const stable = changedRelevant.length === 0 && (command.types ? startingList?.code === 0 && imports.length > 0 : imports.includes("src/shell/runtime.ts") && imports.every(path => path.endsWith(".ts")));
    records.push({ label: command.label, beforeHead, afterHead: head(), startingList, inputsBefore: command.types ? inputsBefore : undefined,
      importedSource, imports, configBefore, configAfter, changedRelevant, allSourceChanges, stable, observations, run });
    console.log(`${command.label}: exit=${run.code}; stable=${stable}; imports=${imports.length}; changed=${JSON.stringify(changedRelevant)}`);
  }
  await save(name, { timestamp: new Date().toISOString(), ready, stage, records });
  if (records.some(record => record.run.code !== 0 || !record.stable || record.run.timedOut || record.run.overflow)) process.exitCode = 1;
} finally { await rm(temporary, { recursive: true, force: true }); }
