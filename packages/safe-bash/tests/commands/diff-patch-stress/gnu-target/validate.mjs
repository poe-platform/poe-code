import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../../..");
assert.equal(repository, "/Users/kjopek/Workspace/safe-bash");
const tag = process.argv[2];
assert(tag && /^[a-z0-9-]+$/u.test(tag), "supply a new evidence tag; existing captures are never overwritten");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceHashes = () => Object.fromEntries(readdirSync(join(repository, "src/commands/diff-patch"))
  .filter(name => name.endsWith(".ts")).sort().map(name => [name, sha256(readFileSync(join(repository, "src/commands/diff-patch", name)))]));
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" });
assert.equal(head.status, 0);
const evidence = { startedAt: new Date().toISOString(), head: head.stdout.trim(), sourceBefore: sourceHashes(), suites: [], typecheck: undefined };
for (const suite of ["compatibility", "fuzz", "safety", "formats", "parser-regressions", "path-regressions", "editflows", "absolute-target", "emptyfile-delta", "gnu-target"]) {
  const directory = join(dirname(owned), suite);
  const files = readdirSync(directory).filter(name => name.endsWith(".test.ts")).sort().map(name => join(directory, name));
  const args = ["--unhandled-rejections=strict", "--import", "tsx", "--test", ...files];
  const result = spawnSync(process.execPath, args, { cwd: repository, encoding: "utf8", timeout: 180_000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 });
  const output = result.stdout + result.stderr;
  const artifact = `${tag}-${suite}.tap`;
  writeFileSync(join(owned, artifact), output, { flag: "wx" });
  const count = name => Number(new RegExp(`^# ${name} (\\d+)$`, "mu").exec(output)?.[1] ?? 0);
  const record = { suite, artifact, command: [process.execPath, ...args], exitCode: result.status, signal: result.signal,
    error: result.error?.message, tests: count("tests"), pass: count("pass"), fail: count("fail"), skipped: count("skipped"), cancelled: count("cancelled"), todo: count("todo"),
    failures: [...output.matchAll(/^not ok \d+ - (.+)$/gmu)].map(match => match[1]), sha256: sha256(output) };
  evidence.suites.push(record);
  console.log(JSON.stringify({ suite, tests: record.tests, pass: record.pass, fail: record.fail, exitCode: record.exitCode }));
}
const check = spawnSync(join(repository, "node_modules/.bin/tsc"), ["--noEmit", "-p", join(owned, "tsconfig.json")], { cwd: repository, encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 });
writeFileSync(join(owned, `${tag}-typecheck.txt`), check.stdout + check.stderr, { flag: "wx" });
evidence.typecheck = { exitCode: check.status, signal: check.signal, error: check.error?.message };
evidence.sourceAfter = sourceHashes();
evidence.sourceChanged = JSON.stringify(evidence.sourceBefore) !== JSON.stringify(evidence.sourceAfter);
evidence.finishedAt = new Date().toISOString();
writeFileSync(join(owned, `${tag}-validation.json`), JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
if (evidence.suites.some(suite => suite.exitCode !== 0 || suite.skipped || suite.cancelled || suite.todo) || check.status !== 0 || evidence.sourceChanged) process.exitCode = 1;
