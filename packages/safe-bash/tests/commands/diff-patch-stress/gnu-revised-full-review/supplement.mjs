import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

const repository = "/Users/kjopek/Workspace/safe-bash";
assert.equal(process.cwd(), repository);
const owned = "tests/commands/diff-patch-stress/gnu-revised-full-review";
const approval = readFileSync("/tmp/safe-bash-diff-revised-full-review-probe-fix.ready", "utf8");
assert(approval.includes("ROOT APPROVED") && approval.includes("mode expectation correction"));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const aggregate = value => digest(JSON.stringify(value));
const main = JSON.parse(readFileSync(join(owned, "RESULT.json")));
const snapshot = realpathSync(main.snapshot);
const previous = join(main.evidence, "independent-review");
const output = mkdtempSync(join(main.evidence, "independent-supplement-"));
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
const expected = JSON.parse(readFileSync(join(previous, "inputs-final.json")));
const dependencies = JSON.parse(readFileSync(join(main.evidence, "dependencies.json")));
const buildOutputs = JSON.parse(readFileSync(join(previous, "build-outputs.json")));
const binaries = JSON.parse(readFileSync(join(main.evidence, "boundaries.json")))[0].binaries;
const roots = ["src", "tests", "benchmarks", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "AGENTS.md", "README.md"];
function inventory(root, selected = roots, exclude = true) {
  const result = {};
  function visit(path) {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) for (const name of readdirSync(absolute).sort()) {
      const child = join(path, name);
      if (exclude && (name === "node_modules" || /^(?:\.native-|\.hunk-native-|patch-gnu-native-)/u.test(name) || child === "benchmarks/reports" || child === `${owned}/.work`)) continue;
      visit(child);
    }
    else result[path] = stat.isSymbolicLink() ? { link: readlinkSync(absolute) } : { sha256: digest(readFileSync(absolute)), size: stat.size, mode: stat.mode & 0o777 };
  }
  for (const path of [...selected].sort()) visit(path);
  return result;
}
assert.deepEqual(inventory(snapshot), expected);
const corrected = readFileSync(join(owned, "probe.mjs"));
const oldTool = readFileSync(join(snapshot, owned, "probe.mjs"));
const toolPath = `${owned}/probe-supplement-${digest(corrected).slice(0, 12)}.mjs`;
writeFileSync(join(snapshot, toolPath), corrected, { flag: "wx", mode: 0o644 });
expected[toolPath] = { sha256: digest(corrected), size: corrected.length, mode: 0o644 };
const stableExpected = Object.fromEntries(Object.entries(expected).sort(([left], [right]) => left.localeCompare(right, "en")));
const toolStat = lstatSync(join(snapshot, toolPath));
expected[toolPath].mode = toolStat.mode & 0o777;
function boundary(name) {
  const inputs = inventory(snapshot);
  const currentDependencies = inventory(join(snapshot, "node_modules"), ["."], false);
  const currentOutputs = inventory(snapshot, ["dist"]);
  assert.deepEqual(inputs, expected);
  assert.deepEqual(currentDependencies, dependencies);
  assert.deepEqual(currentOutputs, buildOutputs);
  assert.equal(digest(readFileSync(join(snapshot, owned, "probe.mjs"))), digest(oldTool));
  for (const [path, info] of Object.entries(binaries)) assert.equal(digest(readFileSync(path)), info.sha256);
  const record = { inputs: aggregate(inputs), source: aggregate(inventory(snapshot, ["src"])), dependencies: aggregate(currentDependencies), buildOutputs: aggregate(currentOutputs), toolSha256: digest(corrected), originalToolSha256: digest(oldTool), binariesStable: true };
  assert.equal(record.source, main.sourceAfter);
  assert.equal(record.dependencies, main.dependenciesAfter);
  assert.equal(record.buildOutputs, main.buildOutputAggregate);
  save(`${name}.json`, record);
  return record;
}
const before = boundary("before");
const env = { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC", TMPDIR: output };
for (const name of Object.keys(env)) if (/^(?:NODE_OPTIONS|NODE_PATH|TSX_|TS_NODE_|DIFF_PATCH_|PARSER_EVIDENCE$|CANDIDATE_EVIDENCE$|CHECKPOINT_|ESBUILD_BINARY_PATH$)/u.test(name)) delete env[name];
env.CHECKPOINT_SNAPSHOT = snapshot;
env.CHECKPOINT_IMPORT_LOG = join(output, "imports");
mkdirSync(env.CHECKPOINT_IMPORT_LOG);
const stdout = openSync(join(output, "stdout"), "wx");
const stderr = openSync(join(output, "stderr"), "wx");
const args = ["--unhandled-rejections=strict", "--import", "./tests/commands/diff-patch-stress/gnu-rmdir-checkpoint/guard.mjs", toolPath, join(output, "native-product.json"), "--product"];
const startedAt = new Date().toISOString();
const execution = spawnSync(process.execPath, args, { cwd: snapshot, env, timeout: 120000, killSignal: "SIGKILL", stdio: ["ignore", stdout, stderr] });
closeSync(stdout); closeSync(stderr);
const after = boundary("after");
assert.deepEqual(after, before);
const result = { author: "independent reviewer72352", approval, approvalSha256: digest(approval), output, snapshot, startedAt, finishedAt: new Date().toISOString(), command: [process.execPath, ...args], status: execution.status, signal: execution.signal, error: execution.error?.message ?? null, before, after, newReviewerToolOnly: toolPath, frozenInputsOverwritten: false, fullCohortsRerun: false, initialFailedProbePreserved: true, stdoutSha256: digest(readFileSync(join(output, "stdout"))), stderrSha256: digest(readFileSync(join(output, "stderr"))) };
save("summary.json", result);
writeFileSync(join(owned, "SUPPLEMENT.json"), JSON.stringify(result, null, 2) + "\n");
const archive = JSON.parse(readFileSync(join(owned, "evidence-archive.json")));
function add(name, path) {
  assert(!(name in archive.files));
  const bytes = readFileSync(path);
  const compressed = gzipSync(bytes);
  assert.deepEqual(gunzipSync(compressed), bytes);
  archive.files[name] = { bytes: bytes.length, sha256: digest(bytes), gzipBase64: compressed.toString("base64") };
}
for (const name of readdirSync(output)) if (lstatSync(join(output, name)).isFile()) add(`supplement/${name}`, join(output, name));
add("supplement/original-failed-probe.mjs", join(snapshot, owned, "probe.mjs"));
add("supplement/corrected-probe.mjs", join(snapshot, toolPath));
add("supplement/driver.mjs", join(owned, "supplement.mjs"));
for (const name of readdirSync(main.evidence).filter(name => /^capture-\d+\.json$/u.test(name))) add(`capture/${name}`, join(main.evidence, name));
writeFileSync(join(owned, "evidence-archive.json"), JSON.stringify(archive, null, 2) + "\n");
if (execution.status === 0) writeFileSync(join(owned, "native-product.json"), readFileSync(join(output, "native-product.json")));
console.log(JSON.stringify(result, null, 2));
if (execution.status !== 0) console.error(readFileSync(join(output, "stderr"), "utf8"));
process.exitCode = execution.status ?? 1;
