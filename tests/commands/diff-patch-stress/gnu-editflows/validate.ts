import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { digest } from "./native.js";

const owned = "tests/commands/diff-patch-stress/gnu-editflows";
async function sourceHashes() {
  const hashes: Record<string, string> = {};
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name.endsWith(".ts")) hashes[path] = digest(await readFile(path));
    }
  };
  await visit("src");
  return { aggregateSha256: digest(JSON.stringify(hashes)), files: hashes };
}

const before = await sourceHashes();
const startedAt = new Date().toISOString();
const args = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", `${owned}/parity.test.ts`, `${owned}/controls.test.ts`];
const tests = spawnSync(process.execPath, args, { encoding: "utf8", shell: false, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
const afterTests = await sourceHashes();
const typecheckArgs = ["--noEmit", "-p", `${owned}/tsconfig.json`];
const typecheck = spawnSync("node_modules/.bin/tsc", typecheckArgs, { encoding: "utf8", shell: false, timeout: 120_000, maxBuffer: 1024 * 1024 });
const afterTypecheck = await sourceHashes();
const counts: Record<string, number> = {};
for (const match of tests.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)) counts[match[1]!] = Number(match[2]);
const failures = [...tests.stdout.matchAll(/^not ok \d+ - (.+)$/gmu)].map(match => match[1]!);
const changedFiles = Object.keys(before.files).filter(path => before.files[path] !== afterTypecheck.files[path]);
const report = {
  startedAt, finishedAt: new Date().toISOString(), node: process.version,
  sourceBefore: before, sourceAfterTests: afterTests, sourceAfterTypecheck: afterTypecheck, changedFiles,
  tests: { command: [process.execPath, ...args], status: tests.status, signal: tests.signal, error: tests.error?.message ?? null, counts, failures, stderr: tests.stderr, tapSha256: digest(tests.stdout) },
  typecheck: { command: ["node_modules/.bin/tsc", ...typecheckArgs], status: typecheck.status, signal: typecheck.signal, error: typecheck.error?.message ?? null, stdout: typecheck.stdout, stderr: typecheck.stderr },
};

process.stdout.write("*** Begin Patch\n");
for (const [name, text] of [["baseline-tap.json", JSON.stringify({ lines: tests.stdout.split("\n") }, null, 2) + "\n"], ["validation.json", JSON.stringify(report, null, 2) + "\n"]]) {
  process.stdout.write(`*** Add File: ${owned}/${name}\n`);
  process.stdout.write(text!.trimEnd().split("\n").map(line => `+${line}`).join("\n") + "\n");
}
process.stdout.write("*** End Patch\n");
process.stderr.write(JSON.stringify({ counts, failures, changedFiles, typecheck: typecheck.status }) + "\n");
