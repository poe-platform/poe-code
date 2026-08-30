import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const owned = "tests/stress/remote-cancellation";
const revision = "3731587fa287333ca59c7a81569b367cec66f61d";
const frozenRevision = "4e26ce0";
const outputPath = process.env.HANDOFF_EVIDENCE ?? `${owned}/handoff3731587-verification.json`;
assert.match(outputPath, /^tests\/stress\/remote-cancellation\/handoff[\w.-]+\.json$/);
assert.equal(existsSync(outputPath), false, "verification evidence is immutable; choose a new owned path for another capture");
const repeats = Number(process.env.HANDOFF_REPEATS ?? 3);
assert.ok(Number.isSafeInteger(repeats) && repeats >= 1 && repeats <= 3);
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim();
const blob = (commit, path) => execFileSync("git", ["show", `${commit}:${path}`], { maxBuffer: 8 * 1024 * 1024 });
const sha = contents => createHash("sha256").update(contents).digest("hex");
const frozenPaths = git("ls-tree", "-r", "--name-only", frozenRevision, owned).split("\n");
const sourcePaths = git("ls-tree", "-r", "--name-only", revision, "src", "tests/fs/webdav/mock.ts").split("\n").filter(path => path.endsWith(".ts"));
const harnessPaths = ["handoff-register.mjs", "handoff-loader.mjs", "handoff-supplement.test.ts", "handoff-verify.mjs", "handoff-tsconfig.json"]
  .map(path => `${owned}/${path}`);
const snapshot = paths => Object.fromEntries(paths.map(path => [path, existsSync(path) ? sha(readFileSync(path)) : null]));
const before = { at: new Date().toISOString(), head: git("rev-parse", "HEAD"), sources: snapshot(sourcePaths), frozen: snapshot(frozenPaths), harness: snapshot(harnessPaths) };
const frozenExpected = Object.fromEntries(frozenPaths.map(path => [path, sha(blob(frozenRevision, path))]));
assert.deepEqual(before.frozen, frozenExpected, "original frozen audit must remain byte-identical");
const sourceExpected = Object.fromEntries(sourcePaths.map(path => [path, sha(blob(revision, path))]));
const results = [];
const loadedSources = new Map();
const typechecks = [];

for (const config of ["handoff-tsconfig.json", "tsconfig.json"]) {
  const args = ["--noEmit", "-p", `${owned}/${config}`];
  const result = spawnSync("node_modules/.bin/tsc", args, { encoding: "utf8", timeout: 30_000 });
  typechecks.push({ command: `node_modules/.bin/tsc ${args.join(" ")}`, exitCode: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`, error: result.error?.message ?? null });
}

for (let repetition = 1; repetition <= repeats; repetition++) {
  for (const cohort of ["frozen-targeted", "supplement"]) {
    const args = ["--unhandled-rejections=strict", "--import", "tsx", "--import", `./${owned}/handoff-register.mjs`,
      "--test", "--test-reporter=tap",
      ...(cohort === "frozen-targeted" ? ["--test-name-pattern=^(D02|D05) ", `${owned}/remote-cancellation.test.ts`] : [`${owned}/handoff-supplement.test.ts`])];
    const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 45_000, maxBuffer: 8 * 1024 * 1024 });
    const raw = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const loaded = [];
    const output = raw.split("\n").filter(line => {
      const match = /^(?:# )?PINNED_SOURCE (.*)$/.exec(line);
      if (!match) return true;
      const source = JSON.parse(match[1]);
      assert.equal(source.revision, revision);
      assert.equal(source.sha256, sourceExpected[source.path], "runtime loader must use committed source bytes");
      loadedSources.set(source.path, source);
      loaded.push(source.path);
      return false;
    }).join("\n");
    const counts = Object.fromEntries([...output.matchAll(/^# (tests|pass|fail|cancelled|skipped|duration_ms) ([\d.]+)/gm)].map(match => [match[1], Number(match[2])]));
    const cases = output.split("\n").filter(line => line.startsWith('# {"name":')).map(line => JSON.parse(line.slice(2)));
    const record = { repetition, cohort, command: `node ${args.map(argument => /[ ()|]/.test(argument) ? `'${argument}'` : argument).join(" ")}`,
      exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, counts, cases, loaded: [...new Set(loaded)].sort(), output };
    results.push(record);
    console.log(JSON.stringify({ repetition, cohort, exitCode: record.exitCode, counts, loaded: record.loaded.length,
      failures: cases.filter(row => row.verdict !== "PASS") }));
    if (record.exitCode !== 0) {
      console.error(`IMMEDIATE VERIFIER FINDING: ${cohort} replay ${repetition} did not pass; no source changes permitted.\n${output}`);
      break;
    }
  }
  if (results.some(result => result.exitCode !== 0)) break;
}

const after = { at: new Date().toISOString(), head: git("rev-parse", "HEAD"), sources: snapshot(sourcePaths), frozen: snapshot(frozenPaths), harness: snapshot(harnessPaths) };
const provenance = [...loadedSources.values()].sort((left, right) => left.path.localeCompare(right.path)).map(source => ({ ...source,
  worktreeBefore: before.sources[source.path], worktreeAfter: after.sources[source.path] }));
const frozenUnchanged = JSON.stringify(before.frozen) === JSON.stringify(after.frozen);
const evidence = {
  schema: 1, purpose: "Independent targeted handoff verification; not a full audit acceptance run", node: process.version, platform: process.platform,
  revision, revisionMetadata: git("show", "--format=fuller", "--no-patch", revision), frozenRevision: git("rev-parse", frozenRevision),
  before: { at: before.at, head: before.head }, after: { at: after.at, head: after.head },
  frozen: { committed: frozenExpected, before: before.frozen, after: after.frozen, unchanged: frozenUnchanged },
  harness: { before: before.harness, after: after.harness, unchanged: JSON.stringify(before.harness) === JSON.stringify(after.harness) },
  sourceIdentity: { mechanism: "in-memory git-show loader, TypeScript development-only transpiler, fails closed on unpinned product module", provenance,
    loadedWorktreeDiffersFromCommit: provenance.filter(source => source.worktreeBefore !== source.sha256 || source.worktreeAfter !== source.sha256).map(source => source.path),
    loadedWorktreeDrift: provenance.filter(source => source.worktreeBefore !== source.worktreeAfter).map(source => source.path) },
  typechecks, results,
  cohorts: { originalFrozen: "24 cases: 20 pass, 4 fail at 4e26ce0; original evidence unchanged",
    authorReported: "22/24 frozen, 18 added tests, 308/308 WebDAV: author report only, not independently rerun",
    independent: "Only D02/D05 plus ten new checks; no inference about unexecuted cases" },
};
const content = JSON.stringify(evidence, null, 2);
execFileSync("apply_patch", [`*** Begin Patch\n*** Add File: ${outputPath}\n${content.split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch`], { stdio: "pipe" });
const passing = frozenUnchanged && evidence.harness.unchanged && typechecks.every(result => result.exitCode === 0)
  && results.length === repeats * 2 && results.every(result => result.exitCode === 0
    && result.counts.tests === (result.cohort === "frozen-targeted" ? 2 : 10)
    && result.counts.pass === result.counts.tests && result.counts.fail === 0 && result.counts.cancelled === 0
    && result.counts.skipped === 0 && result.loaded.includes("src/fs/webdav/webdav.ts"));
console.log(JSON.stringify({ outputPath, passing, frozenUnchanged, typechecks, sourceDrift: evidence.sourceIdentity.loadedWorktreeDrift }, null, 2));
process.exitCode = passing ? 0 : 1;
