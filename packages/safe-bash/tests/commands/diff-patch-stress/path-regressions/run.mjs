import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const repository = fileURLToPath(new URL("../../../../", import.meta.url));
function hashes() {
  const relativePaths = [
    ...readdirSync(`${repository}/src/commands/diff-patch`).filter(name => name.endsWith(".ts")).map(name => `src/commands/diff-patch/${name}`),
    "src/shell/runtime.ts", "src/shell/shell.ts", "src/shell/types.ts",
  ];
  return Object.fromEntries(relativePaths.map(path => [path, createHash("sha256").update(readFileSync(`${repository}/${path}`)).digest("hex")]));
}
const before = hashes();
const ownedTests = Object.fromEntries(readdirSync(directory).filter(name => name.endsWith(".ts") || name === "tsconfig.json")
  .sort().map(name => [name, createHash("sha256").update(readFileSync(`${directory}/${name}`)).digest("hex")]));
const started = new Date().toISOString();
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).stdout.trim();
const tests = readdirSync(directory).filter(name => name.endsWith(".test.ts")).sort().map(name => `${directory}/${name}`);
const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", ...tests], {
  cwd: repository, encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
});
const after = hashes();
const output = result.stdout ?? "";
const counters = Object.fromEntries([...output.matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)$/gmu)].map(match => [match[1], Number(match[2])]));
const failures = [...output.matchAll(/^not ok \d+ - (.+)$/gmu)].map(match => match[1]);
console.log(JSON.stringify({ started, finished: new Date().toISOString(), head, node: process.version, status: result.status,
  signal: result.signal, error: result.error?.message, counters, failures, stderr: result.stderr, sourceStable: JSON.stringify(before) === JSON.stringify(after), ownedTests, before, after }, null, 2));
process.exitCode = result.status ?? 1;
