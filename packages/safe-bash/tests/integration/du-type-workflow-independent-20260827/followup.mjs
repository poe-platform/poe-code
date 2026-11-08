import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const owned = dirname(fileURLToPath(import.meta.url));
const receipts = join(owned, process.argv[2] ?? "receipts");
const state = JSON.parse(readFileSync(join(receipts, "state.json")));
const authenticated = JSON.parse(readFileSync(join(receipts, "authentication.json")));
const author = JSON.parse(readFileSync(join(receipts, "author-binding.json")));
const destination = join(receipts, "followup"); mkdirSync(destination);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
const inventory = directory => {
  const records = [];
  const walk = prefix => {
    for (const name of readdirSync(join(directory, prefix)).sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      const info = lstatSync(join(directory, path));
      if (info.isDirectory()) walk(path);
      else {
        const bytes = readFileSync(join(directory, path));
        records.push({ path, ...(info.isSymbolicLink() ? { symlink: readlinkSync(join(directory, path)) } : {}), bytes: bytes.length, sha256: digest(bytes) });
      }
    }
  }; walk(""); return records;
};
const sorted = entries => [...entries].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
const initial = JSON.parse(readFileSync(join(receipts, "execution.json")));
const report = { candidate: initial.candidate, startedAt: new Date().toISOString(), correctionsOnly: true, initialExecutionUnchanged: { sha256: digest(readFileSync(join(receipts, "execution.json"))), failures: initial.failures.map(entry => entry.name) }, checks: [], commands: [], failures: [] };
const save = () => json(join(destination, "result.json"), report);
const check = (name, operation) => { try { const detail = operation(); report.checks.push({ name, status: "pass", detail }); } catch (error) { report.checks.push({ name, status: "fail", error: error.stack }); report.failures.push({ name, error: error.message }); } save(); };
for (const tool of authenticated.tools) assert.equal(digest(readFileSync(tool.path)), tool.sha256);
for (const tool of authenticated.npmTrees) assert.deepEqual(sorted(inventory(tool.root)), sorted(tool.files));
assert.deepEqual(sorted(inventory(join(state.root, "node_modules"))), sorted(authenticated.developmentDependencies));
const supervisors = ["followup.mjs", "reporter-probe-v2.mjs"].map(path => ({ path, bytes: readFileSync(join(owned, path)).length, sha256: digest(readFileSync(join(owned, path))) }));
const moved = join(state.work, "moved package with spaces");
const before = inventory(moved);
assert.equal(digest(readFileSync(join(moved, "du-leaf.mts"))), digest(readFileSync(join(receipts, "fixtures/du-leaf.mts.fixture"))));
json(join(destination, "before.json"), { supervisors, tools: authenticated.tools, packageAndConsumer: before, permissionCorrection: "Node24 accepts --permission, not the Node22 --experimental-permission flag used by the first reviewer attempt", inventoryCorrection: "Compare sorted complete path/hash records; recursive directory ordering differs from flat path ordering", reporterCorrection: "Append TAP to the forwarding current npm wrapper; insert TAP before the positional glob in the historical direct-node script, solely in independent synthetic fixtures" });
copyFileSync(join(moved, "du-leaf.mjs"), join(destination, "du-leaf.mjs.fixture"));
const execute = (name, runtime, args, expected) => {
  const env = { ...process.env, PATH: dirname(runtime) + ":" + dirname(state.runtimePaths[0]) + ":/usr/bin:/bin:/usr/sbin:/sbin", TSX_DISABLE_CACHE: "1", npm_config_cache: join(state.work, "npm-cache"), npm_config_update_notifier: "false", TMPDIR: state.work };
  delete env.NODE_OPTIONS; delete env.NODE_TEST_CONTEXT;
  const startedAt = new Date().toISOString();
  const result = spawnSync(runtime, args, { cwd: moved, env, encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  const record = { name, executable: runtime, args, cwd: moved, startedAt, finishedAt: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  const bytes = Buffer.from(JSON.stringify(record, null, 2) + "\n"); writeFileSync(join(destination, `${name}.json.gz`), gzipSync(bytes));
  report.commands.push({ name, status: result.status, expected, signal: result.signal, bytes: bytes.length, sha256: digest(bytes), file: `${name}.json.gz` });
  if (result.status !== expected || result.signal || result.error) report.failures.push({ name, expected, status: result.status, error: result.error?.message }); save(); return result;
};
const [node22, node24] = state.runtimePaths;
execute("moved-du-node24-stable-permission", node24, ["--permission", `--allow-fs-read=${moved}`, join(moved, "du-leaf.mjs")], 0);
const denied = execute("source-denial-node24-stable-permission", node24, ["--permission", `--allow-fs-read=${moved}`, "--input-type=module", "-e", `import {readFileSync} from 'node:fs';readFileSync(${JSON.stringify(join(state.root, "src/commands/du/index.ts"))});`], 1);
check("source denial is ERR_ACCESS_DENIED with stable Node24 flag", () => assert.match(denied.stderr, /ERR_ACCESS_DENIED/u));
for (const [label, runtime] of [["node22", node22], ["node24", node24]]) {
  const result = execute(`reporter-placement-${label}`, runtime, [join(owned, "reporter-probe-v2.mjs"), state.root, join(destination, `nested-${label}`)], 0);
  check(`explicit reporter placement verified on ${label}`, () => { const summary = JSON.parse(result.stdout); assert.deepEqual(summary.explicitTapFiltered, { tests: 5, pass: 5, status: 0 }); assert.deepEqual(summary.explicitTapUnfiltered, { tests: 7, fail: 2, status: 1 }); return summary; });
}
check("all 282 selected Git inputs byte-identical with no new files", () => {
  const actual = sorted(inventory(state.root).filter(entry => !entry.path.startsWith("node_modules/")));
  const expected = sorted(authenticated.selectedInputs.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })));
  assert.deepEqual(actual, expected); return { files: actual.length, detectsNewRegularFiles: true };
});
check("all 830 package regular files unchanged with no new files", () => { const actual = inventory(join(moved, "node_modules/virtual-bash")); assert.ok(actual.every(entry => !entry.symlink)); assert.deepEqual(sorted(actual), sorted(author.package.before)); return { files: actual.length, detectsNewRegularFiles: true }; });
check("consumer and configs unchanged by followup", () => assert.deepEqual(inventory(moved), before));
check("copied development tools unchanged after followup", () => assert.deepEqual(sorted(inventory(join(state.root, "node_modules"))), sorted(authenticated.developmentDependencies)));
for (const tool of authenticated.tools) assert.equal(digest(readFileSync(tool.path)), tool.sha256);
json(join(destination, "after.json"), { selectedInputs: sorted(inventory(state.root).filter(entry => !entry.path.startsWith("node_modules/"))), packageAndConsumer: inventory(moved), toolInputs: authenticated.tools });
report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ commands: report.commands.map(({ name, status }) => ({ name, status })), checks: report.checks.length, failures: report.failures }));
process.exitCode = report.failures.length ? 1 : 0;
