import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const candidate = "e422ad06b3470477b7f9323c89289d2963a00407";
const baseline = git("rev-parse", `${candidate}^`).toString().trim();
const fixture = "tests/plugins/qualified-current-release-native-data/controls.test.ts";
const prefix = "tests/plugins/qualified-current-release-native-data";
const selected = [fixture, `${prefix}/helpers.ts`, `${prefix}/before-02.json`, `${prefix}/classification.json`,
  "package.json", "tsconfig.json", "tests/plugins/qualified-current-release/consumers.mjs",
  "tests/plugins/qualified-current-release/captured-types.json", "tests/plugins/qualified-current-release/staged-types.json",
  "tests/integration/adapter-tools/atomic-webdav-profile/atomic-mock.ts",
  "tests/integration/adapter-tools/atomic-webdav-profile/controls.ts",
  "tests/integration/adapter-tools/atomic-webdav-profile-independent/hidden.ts",
  "tests/shell-stress/env-split-consumer/packed-public-types.ts"].sort();
const node22 = "/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node";
const node24 = "/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node";
const npmCli = realpathSync("/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm/bin/npm-cli.js");
const directory = realpathSync(mkdtempSync(join(tmpdir(), "native-data-tap-author-")));
const report = { baseline, candidate, directory, startedAt: new Date().toISOString(), scope: "two-line canonical fixture TAP repair; synthetic compile/test boundaries only, not production or full gate", commands: [], checks: [], failures: [] };
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
function check(name, callback) {
  try { callback(); report.checks.push({ name, status: "pass" }); }
  catch (error) { report.checks.push({ name, status: "fail", error: error.stack }); report.failures.push(name); }
}
function inventory(root) {
  const result = [];
  function walk(relative) {
    for (const name of readdirSync(join(root, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      if (path === "node_modules") continue;
      const stat = lstatSync(join(root, path));
      assert.equal(stat.isSymbolicLink(), false, path);
      if (stat.isDirectory()) { result.push({ path, kind: "directory" }); walk(path); }
      else { assert.equal(stat.isFile(), true); result.push({ path, kind: "file", sha256: digest(readFileSync(join(root, path))) }); }
    }
  }
  walk(""); return result;
}
console.log(JSON.stringify({ directory, candidate, baseline }));
try {
  assert.deepEqual(git("diff", "--name-only", baseline, candidate).toString().trim().split("\n"), [fixture]);
  const before = git("show", `${baseline}:${fixture}`).toString();
  const after = git("show", `${candidate}:${fixture}`).toString();
  const replacement = before.replace('run(copy.directory, "npm", ["test"]);', 'run(copy.directory, "npm", ["test", "--", "--test-reporter=tap"]);')
    .replace('test: original.before.testScript }', 'test: original.before.testScript.replace("--test ", "--test --test-reporter=tap ") }');
  assert.notEqual(before, replacement); assert.equal(after, replacement);
  report.fixtureMapping = { path: fixture, beforeSha256: digest(Buffer.from(before)), afterSha256: digest(Buffer.from(after)), beforeBlob: git("rev-parse", `${baseline}:${fixture}`).toString().trim(), afterBlob: git("rev-parse", `${candidate}:${fixture}`).toString().trim(), diff: git("diff", baseline, candidate, "--", fixture).toString() };
  report.tools = [node22, node24, npmCli, join(repository, "node_modules/typescript/lib/_tsc.js"), join(repository, "node_modules/tsx/package.json")].map(path => ({ path, sha256: digest(readFileSync(path)) }));
  report.versions = [node22, node24].map(executable => ({ executable, version: execFileSync(executable, ["--version"]).toString().trim(), npm: execFileSync(executable, [npmCli, "--version"]).toString().trim() }));
  assert.deepEqual(report.versions.map(row => row.version), ["v22.22.2", "v24.11.1"]);
  const tools = join(directory, "tooling", "node_modules"); mkdirSync(dirname(tools), { recursive: true });
  cpSync(join(repository, "node_modules"), tools, { recursive: true, dereference: true });
  const trace = join(directory, "trace.mjs");
  writeFileSync(trace, 'import {appendFileSync} from "node:fs"; appendFileSync(process.env.TAP_REVIEW_TRACE, JSON.stringify({pid:process.pid,ppid:process.ppid,executable:process.execPath,version:process.version,argv:process.argv})+"\\n");\n');
  report.traceSha256 = digest(readFileSync(trace));
  const userConfig = join(directory, "empty-user.npmrc"), globalConfig = join(directory, "empty-global.npmrc");
  writeFileSync(userConfig, ""); writeFileSync(globalConfig, "");
  const variants = [
    { name: "baseline-node22", commit: baseline, executable: node22, expected: 0, tests: 8, pass: 8, fail: 0 },
    { name: "baseline-node24", commit: baseline, executable: node24, expected: 1, tests: 8, pass: 7, fail: 1 },
    { name: "candidate-node22", commit: candidate, executable: node22, expected: 0, tests: 8, pass: 8, fail: 0 },
    { name: "candidate-node24", commit: candidate, executable: node24, expected: 0, tests: 8, pass: 8, fail: 0 },
    { name: "remove-current-reporter-node24", commit: candidate, executable: node24, expected: 1, mutate: source => source.replace('["test", "--", "--test-reporter=tap"]', '["test"]') },
    { name: "remove-historical-reporter-node24", commit: candidate, executable: node24, expected: 1, mutate: source => source.replace('original.before.testScript.replace("--test ", "--test --test-reporter=tap ")', 'original.before.testScript') },
  ];
  for (const variant of variants) {
    const root = join(directory, variant.name, "input"), shim = join(directory, variant.name, "bin"); mkdirSync(root, { recursive: true }); mkdirSync(shim);
    const inputs = selected.map(path => {
      const bytes = git("show", `${variant.commit}:${path}`);
      const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
      return { path, sha256: digest(bytes), blob: git("rev-parse", `${variant.commit}:${path}`).toString().trim() };
    });
    if (variant.mutate) {
      const target = join(root, fixture), bytes = readFileSync(target, "utf8"), modified = variant.mutate(bytes);
      assert.notEqual(modified, bytes); writeFileSync(target, modified);
    }
    symlinkSync(tools, join(root, "node_modules"), "dir");
    symlinkSync(variant.executable, join(shim, "node"));
    writeFileSync(join(shim, "npm"), `#!/bin/sh\nexec ${JSON.stringify(variant.executable)} ${JSON.stringify(npmCli)} "$@"\n`, { mode: 0o755 });
    const beforeInventory = inventory(root), tracePath = join(directory, `${variant.name}.trace.jsonl`);
    const env = { PATH: `${shim}:/usr/bin:/bin`, HOME: directory, LC_ALL: "C", TZ: "UTC", TSX_DISABLE_CACHE: "1", NODE_OPTIONS: `--import=${trace}`, TAP_REVIEW_TRACE: tracePath, npm_config_cache: join(directory, "npm-cache"), npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig, npm_config_update_notifier: "false" };
    const args = ["--import", "tsx", "--test", "--test-reporter=tap", ...(variant.mutate ? ["--test-name-pattern=actual npm script"] : []), fixture];
    const result = spawnSync(variant.executable, args, { cwd: root, env, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    const counts = Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
    const children = readFileSync(tracePath, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const afterInventory = inventory(root);
    const record = { ...variant, mutate: variant.mutate ? "explicit reporter removal in isolated mutant only" : undefined, inputs, executable: variant.executable, args, cwd: root, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr, counts, children, beforeInventory, afterInventory };
    json(join(directory, `${variant.name}.json`), record); report.commands.push({ name: variant.name, status: result.status, expected: variant.expected, counts, hostStarts: children.length });
    check(`${variant.name}: natural expected status and exact public outer counts`, () => {
      assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, variant.expected);
      if (variant.mutate) { assert.equal(counts.fail, 1); assert.match(result.stdout, /AssertionError/u); }
      else assert.deepEqual(counts, { tests: variant.tests, pass: variant.pass, fail: variant.fail, cancelled: 0, skipped: 0, todo: 0 });
      if (variant.expected === 1) {
        assert.match(result.stdout, /input did not match the regular expression/u);
        assert.ok(result.stdout.includes(`# tests ${variant.name === "remove-historical-reporter-node24" ? 7 : 5}`));
        assert.doesNotMatch(result.stdout + result.stderr, /double-loading config|ERR_MODULE_NOT_FOUND|SyntaxError/u);
      }
    });
    check(`${variant.name}: actual npm/node/tsc/test children use selected runtime`, () => {
      assert.ok(children.length >= 5); assert.ok(children.some(child => child.argv.includes(npmCli)));
      for (const child of children) { assert.equal(realpathSync(child.executable), realpathSync(variant.executable)); assert.equal(child.version, report.versions.find(row => row.executable === variant.executable).version); }
    });
    check(`${variant.name}: protected inputs unchanged with no added entries`, () => assert.deepEqual(afterInventory, beforeInventory));
  }
  check("selected tools remain unchanged", () => { for (const tool of report.tools) assert.equal(digest(readFileSync(tool.path)), tool.sha256); });
} catch (error) { report.failures.push({ fatal: error.stack }); }
finally {
  report.finishedAt = new Date().toISOString(); report.status = report.failures.length ? "fail" : "pass";
  json(join(directory, "REPORT.json"), report);
  console.log(JSON.stringify({ directory, candidate, status: report.status, commands: report.commands, checks: report.checks.length, failures: report.failures }));
  if (report.failures.length) process.exitCode = 1;
}
