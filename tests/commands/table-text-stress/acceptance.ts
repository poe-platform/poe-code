import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { hash, hashes, oracle, save } from "./support.js";

const cohorts = [
  { name: "independent", arguments: ["--unhandled-rejections=strict", "--import", "tsx", "--test", "tests/commands/table-text-stress/contracts.test.ts", "tests/commands/table-text-stress/corpus.test.ts"], nativeCalls: 71 },
  { name: "unchanged-author311", arguments: ["--unhandled-rejections=strict", "--import", "tsx", "--test", "tests/commands/table-text/*.test.ts", "tests/plugins/agent-commands.test.ts", "tests/integration/adapter-tools-diagnostics/eight-cases.test.ts", "tests/commands/structured-stress/split-increment/interop.test.ts", "tests/commands/structured-stress/final-increment/fresh-interop.test.ts"], nativeCalls: 216 },
  { name: "scoped-types", arguments: ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tests/commands/table-text-stress/tsconfig.json"], nativeCalls: 0 },
];
const results = [];
for (const cohort of cohorts) {
  const before = await hashes();
  const oracleHashes: Record<string, string> = {};
  for (const command of ["paste", "comm", "join"]) oracleHashes[command] = hash(await readFile(`${oracle}/src/${command}`));
  const result = spawnSync(process.execPath, cohort.arguments, { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GNU_TABLE_BIN: `${oracle}/src` } });
  const after = await hashes();
  const drift = [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].filter(path => before.files[path] !== after.files[path]);
  const oracleHashesAfter: Record<string, string> = {};
  for (const command of ["paste", "comm", "join"]) oracleHashesAfter[command] = hash(await readFile(`${oracle}/src/${command}`));
  results.push({ name: cohort.name, command: [process.execPath, ...cohort.arguments], nativeWorkloadCalls: cohort.nativeCalls, versionCalls: cohort.nativeCalls ? 3 : 0, before, after, drift, oracleHashes, oracleHashesAfter, exitCode: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
}
save(process.argv[2] ?? "acceptance.json", results);
console.log(results.map(result => ({ name: result.name, exitCode: result.exitCode, drift: result.drift, summary: result.stdout.slice(-250) })));
assert.ok(results.every(result => result.exitCode === 0));
