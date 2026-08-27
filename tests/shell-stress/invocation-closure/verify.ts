import { mkdtemp, readFile, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { boundedProcess, head, owned, save, sha256, sourceHashes } from "./support.js";

const name = process.argv[2] ?? "verification.json";
const stage = process.argv[3] ?? "new";
const ready = stage === "prepare" ? "PREPARATION ONLY, no source acceptance" : await readFile("/tmp/safe-bash-shell-invocation-closure-ready.txt", "utf8");
const bomReady = stage === "prepare" ? "PREPARATION ONLY" : await readFile("/tmp/safe-bash-shell-bom-fix-ready.txt", "utf8");
const temporary = await mkdtemp(resolve(owned, ".verify-"));
const hook = ["--unhandled-rejections=strict", "--import", "tsx", "--import", "./tests/shell-stress/invocation-modes/trace.mjs"];
const strict = ["node_modules/typescript/bin/tsc", "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck"];
const commands: Record<string, { args: string[]; types?: boolean; label: string }[]> = {
  prepare: [{ label: "owned preparation types", types: true, args: [...strict, ...["support", "cases", "native", "probe", "holdout.test", "verify", "compare", "precedence-native"].map(path => `${owned}/${path}.ts`)] }],
  new: [{ label: "new 34 holdouts", args: [...hook, "--test", `${owned}/holdout.test.ts`] }],
  legacy: [
    { label: "unchanged 72", args: [...hook, "--test", "tests/shell-stress/invocation-modes/holdout.test.ts"] },
    { label: "unchanged 132", args: [...hook, "--test", "tests/shell/invocation-modes.test.ts"] },
  ],
  author: [{ label: "new author 211", args: [...hook, "--test", ...["discovery", "read", "sh"].map(group => `tests/shell/invocation-closure-${group}.test.ts`)] }],
  precedence: [{ label: "revised prior file 58", args: [...hook, "--test", "tests/shell/script-entrypoint.test.ts", "tests/shell-stress/script-entrypoint/holdout.test.ts"] }],
  previous: [
    { label: "previous file 58", args: [...hook, "--test", "tests/shell/script-entrypoint.test.ts", "tests/shell-stress/script-entrypoint/holdout.test.ts"] },
    { label: "selected regressions", args: [...hook, "--test", ...["core", "invoke", "stdin-origin", "input-units", "descriptor-inheritance", "glob-budget", "inline-input-limits", "read-options", "read-fields", "variable-scope"].map(path => `tests/shell/${path}.test.ts`)] },
  ],
  types: [
    { label: "global noEmit", types: true, args: ["node_modules/typescript/bin/tsc", "--noEmit"] },
    { label: "build noEmit", types: true, args: ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json", "--noEmit"] },
    { label: "benchmark noEmit", types: true, args: ["node_modules/typescript/bin/tsc", "-p", "benchmarks/tsconfig.json", "--noEmit"] },
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
    if (stage !== "prepare") {
      const expected = Object.fromEntries([...ready.matchAll(/(src\/shell\/\S+\.ts) ([a-f0-9]{64})/gu)].map(match => [match[1]!, match[2]!]));
      expected["src/shell/shell.ts"] = /New Shell SHA256: ([a-f0-9]{64})/u.exec(bomReady)![1]!;
      for (const [path, hash] of Object.entries(expected)) if (sourceBefore[path] !== hash) throw new Error(`READY shell guard mismatch: ${path}`);
    }
    const env = { PATH: "/usr/bin:/bin", HOME: "/nonexistent", LANG: "C", LC_ALL: "C", TZ: "UTC", INVOCATION_TRACE: trace, CLOSURE_OBSERVATIONS: observationPath };
    const compilerPaths = (output: string): string[] => [...new Set(output.split("\n").filter(line => line.startsWith("/") && /\.(?:ts|mts|cts|tsx)$/u.test(line)).map(path => relative(process.cwd(), path)))].sort();
    const startingList = await boundedProcess(process.execPath, [...(command.types ? command.args : ["node_modules/typescript/bin/tsc", "--noEmit"]), "--listFilesOnly"], { cwd: process.cwd(), env, deadlineMs: 60000 });
    const inputsBefore: Record<string, string> = {};
    if (startingList) for (const path of compilerPaths(startingList.stdout)) inputsBefore[path] = sha256(await readFile(path));
    const configBefore = Object.fromEntries(await Promise.all(["tsconfig.json", "tsconfig.build.json"].map(async path => [path, sha256(await readFile(path))])));
    const executionPaths = [...new Set([...command.args.filter(path => /\.(?:ts|mjs)$/u.test(path)), ...["cases.ts", "probe.ts", "holdout.test.ts"].map(path => `${owned}/${path}`), "tests/shell-stress/invocation-modes/cases.ts", "tests/shell-stress/invocation-modes/harness.ts", "tests/shell-stress/invocation-modes/virtual-child.ts", "tests/shell-stress/script-entrypoint/cases.ts", "tests/shell-stress/script-entrypoint/probe.ts", "package.json", "package-lock.json", "benchmarks/tsconfig.json"] )];
    const executionBefore = Object.fromEntries(await Promise.all(executionPaths.map(async path => [path, sha256(await readFile(path))])));
    const run = await boundedProcess(process.execPath, [...command.args, ...(command.types ? ["--listFiles"] : [])], { cwd: process.cwd(), env, deadlineMs: 120000 });
    const sourceAfter = await sourceHashes();
    const imports = command.types ? compilerPaths(run.stdout) : [...new Set((await readFile(trace, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(path => relative(process.cwd(), path)))].sort();
    const importedSource: Record<string, { before: string | null; after: string | null }> = {};
    for (const path of imports) importedSource[path] = { before: inputsBefore[path] ?? null, after: command.types ? await readFile(path).then(sha256).catch(() => null) : sourceAfter[path] ?? null };
    const changedRelevant = Object.entries(importedSource).filter(([, hashes]) => hashes.before === null || hashes.before !== hashes.after).map(([path]) => path);
    const configAfter = Object.fromEntries(await Promise.all(["tsconfig.json", "tsconfig.build.json"].map(async path => [path, sha256(await readFile(path))])));
    if (command.types) for (const path of Object.keys(configBefore)) if (configBefore[path] !== configAfter[path]) changedRelevant.push(path);
    const executionAfter = Object.fromEntries(await Promise.all(executionPaths.map(async path => [path, await readFile(path).then(sha256).catch(() => null)])));
    for (const path of executionPaths) if (executionBefore[path] !== executionAfter[path]) changedRelevant.push(path);
    const allSourceChanges = [...new Set([...Object.keys(sourceBefore), ...Object.keys(sourceAfter)])].filter(path => sourceBefore[path] !== sourceAfter[path]);
    const observations = (await readFile(observationPath, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as unknown);
    const stable = changedRelevant.length === 0 && startingList.code === 0 && (command.types ? imports.length > 0 : imports.includes("src/shell/runtime.ts") && imports.every(path => path.endsWith(".ts")));
    records.push({ label: command.label, beforeHead, afterHead: head(), sourceBefore, sourceAfter, startingList, inputsBefore,
      importedSource, imports, configBefore, configAfter, executionBefore, executionAfter, changedRelevant, allSourceChanges, stable, observations, run });
    console.log(`${command.label}: exit=${run.code}; stable=${stable}; imports=${imports.length}; changed=${JSON.stringify(changedRelevant)}`);
  }
  await save(name, { timestamp: new Date().toISOString(), ready, bomReady, stage, records });
  if (records.some(record => record.run.code !== 0 || !record.stable || record.run.timedOut || record.run.overflow)) process.exitCode = 1;
} finally { await rm(temporary, { recursive: true, force: true }); }
