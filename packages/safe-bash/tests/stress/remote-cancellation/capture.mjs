import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const owned = "tests/stress/remote-cancellation";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
const snapshot = () => Object.fromEntries([...new Set([
  ...walk("src"), ...walk(owned).filter(path => /\.(?:ts|mjs)$/.test(path)),
  "AGENTS.md", "README.md", "package.json", "package-lock.json", "tsconfig.json",
  "tests/fs/webdav/mock.ts", "tests/integration/adapter-tools/matrix.test.ts",
  "tests/integration/adapter-tools/README.md",
])].sort().map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const status = () => git("status", "--short", "--untracked-files=all").split("\n").filter(line => !line.includes(owned));
const startedAt = new Date().toISOString();
const before = { head: git("rev-parse", "HEAD"), status: status(), hashes: snapshot() };
const typecheckCommand = "node_modules/.bin/tsc --noEmit -p tests/stress/remote-cancellation/tsconfig.json";
const typecheck = spawnSync("node_modules/.bin/tsc", ["--noEmit", "-p", `${owned}/tsconfig.json`], { encoding: "utf8", timeout: 30_000 });
const command = "AUDIT_REPEATS=3 AUDIT_VERBOSE=1 node tests/stress/remote-cancellation/run.mjs";
const result = spawnSync(process.execPath, [`${owned}/run.mjs`], {
  env: { ...process.env, AUDIT_REPEATS: "3", AUDIT_VERBOSE: "1" }, encoding: "utf8", timeout: 210_000, maxBuffer: 4 * 1024 * 1024,
});
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const replays = output.split(/(?=REPLAY \d+: exit=)/).filter(block => block.startsWith("REPLAY ")).map(block => ({
  header: block.split("\n")[0],
  counts: Object.fromEntries([...block.matchAll(/^# (tests|pass|fail|cancelled|skipped|duration_ms) ([\d.]+)/gm)].map(match => [match[1], Number(match[2])])),
  cases: block.split("\n").filter(line => line.startsWith('# {"name":')).map(line => JSON.parse(line.slice(2))),
}));
const afterHashes = snapshot();
const changed = [...new Set([...Object.keys(before.hashes), ...Object.keys(afterHashes)])].filter(path => before.hashes[path] !== afterHashes[path]);
const after = { head: git("rev-parse", "HEAD"), status: status(), hashDrift: changed.map(path => ({ path, before: before.hashes[path] ?? null, after: afterHashes[path] ?? null })) };
const evidence = {
  startedAt, completedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  before, after, typecheck: { command: typecheckCommand, exitCode: typecheck.status, output: `${typecheck.stdout}${typecheck.stderr}` },
  command, exitCode: result.status, childSignal: result.signal, error: result.error?.message ?? null,
  outerWatchdog: output.includes("OUTER WATCHDOG:"), residualProcessGroup: output.includes("RESIDUAL PROCESS GROUP:"),
  replays,
};
const path = `${owned}/evidence.json`;
const content = `${JSON.stringify(evidence, null, 2)}\n`;
const patch = existsSync(path)
  ? `*** Update File: ${path}\n@@\n${readFileSync(path, "utf8").trimEnd().split("\n").map(line => `-${line}`).join("\n")}\n${content.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n`
  : `*** Add File: ${path}\n${content.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n`;
execFileSync("apply_patch", [`*** Begin Patch\n${patch}*** End Patch`], { stdio: "pipe" });
console.log(JSON.stringify({ path, startedAt, completedAt: evidence.completedAt, beforeHead: before.head, afterHead: after.head,
  typecheck: typecheck.status, drift: after.hashDrift, outerWatchdog: evidence.outerWatchdog, residualProcessGroup: evidence.residualProcessGroup,
  replays: replays.map(replay => ({ header: replay.header, counts: replay.counts,
    failures: replay.cases.filter(result => result.verdict !== "PASS").map(result => ({ name: result.name, events: result.events.filter(event => /failure:|before-rescue/.test(event)) })),
    pipelines: replay.cases.reduce((total, result) => total + result.pipelines, 0),
    httpCleanup: replay.cases.flatMap(result => result.events.filter(event => event.startsWith("http.final:"))),
  })) }, null, 2));
process.exitCode = result.status === 0 && typecheck.status === 0 ? 0 : 1;
