import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "/Users/kjopek/Workspace/safe-bash";
assert.equal(process.cwd(), repository);
const [evidence, tool] = process.argv.slice(2);
assert(evidence && /^tests\/commands\/diff-patch-stress\/gnu-rmdir-checkpoint\/[\w-]+\.mjs$/u.test(tool), "explicit evidence and owned supplement tool required");
const identity = JSON.parse(readFileSync(join(evidence, "identity.json"), "utf8"));
const snapshot = identity.snapshot;
const digest = value => createHash("sha256").update(value).digest("hex");
const aggregate = value => digest(JSON.stringify(value));
function inventory(root, selected, exclude) {
  const entries = {};
  function visit(path) {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (exclude && (name === "node_modules" || /^(?:\.native-|\.hunk-native-|patch-gnu-native-)/u.test(name) || join(path, name) === "benchmarks/reports")) continue;
        visit(join(path, name));
      }
    } else if (stat.isSymbolicLink()) entries[path] = { link: readlinkSync(absolute) };
    else { assert(stat.isFile()); entries[path] = { sha256: digest(readFileSync(absolute)), size: stat.size, mode: stat.mode & 0o777 }; }
  }
  for (const path of [...selected].sort()) visit(path);
  return entries;
}
const expectedInputs = JSON.parse(readFileSync(join(evidence, "inputs.json"), "utf8"));
const expectedDependencies = JSON.parse(readFileSync(join(evidence, "dependencies-before.json"), "utf8"));
const expectedOutputs = JSON.parse(readFileSync(join(evidence, "snapshot-outputs.json"), "utf8"));
const supplement = mkdtempSync(join(evidence, "supplement-"));
const imports = join(supplement, "imports");
mkdirSync(imports);
const toolBytes = readFileSync(tool);
const wrapperPath = fileURLToPath(import.meta.url);
const wrapperBytes = readFileSync(wrapperPath);
writeFileSync(join(supplement, "tool.mjs"), toolBytes, { flag: "wx" });
writeFileSync(join(supplement, "wrapper.mjs"), wrapperBytes, { flag: "wx" });
function boundary(name) {
  const inputs = inventory(snapshot, identity.roots, true);
  const dependencies = inventory(join(snapshot, "node_modules"), ["."], false);
  const outputs = Object.fromEntries(Object.entries(inventory(snapshot, ["."], true)).filter(([path]) => !(path in expectedInputs)));
  assert.deepEqual(inputs, expectedInputs, `${name}: frozen input changed`);
  assert.deepEqual(dependencies, expectedDependencies, `${name}: frozen dependency changed`);
  assert.deepEqual(outputs, expectedOutputs, `${name}: frozen build output changed`);
  for (const [path, info] of Object.entries(identity.binaries)) assert.equal(digest(readFileSync(path)), info.sha256, `${name}: executable changed ${path}`);
  const record = { inputAggregate: aggregate(inputs), sourceAggregate: aggregate(Object.fromEntries(Object.entries(inputs).filter(([path]) => path.startsWith("src/")))), dependencyAggregate: aggregate(dependencies), outputAggregate: aggregate(outputs), toolSha256: digest(readFileSync(tool)), wrapperSha256: digest(readFileSync(wrapperPath)), binariesStable: true };
  writeFileSync(join(supplement, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  assert.equal(record.toolSha256, digest(toolBytes));
  assert.equal(record.wrapperSha256, digest(wrapperBytes));
  return record;
}
const environment = { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC", TMPDIR: supplement };
for (const name of Object.keys(environment)) if (/^(?:NODE_OPTIONS|NODE_PATH|TSX_|TS_NODE_|DIFF_PATCH_|PARSER_EVIDENCE$|CANDIDATE_EVIDENCE$|CHECKPOINT_|ESBUILD_BINARY_PATH$)/u.test(name)) delete environment[name];
environment.CHECKPOINT_SNAPSHOT = snapshot;
environment.CHECKPOINT_IMPORT_LOG = imports;
const startedAt = new Date().toISOString();
const before = boundary("before");
const args = ["--unhandled-rejections=strict", "--import", "./tests/commands/diff-patch-stress/gnu-rmdir-checkpoint/guard.mjs", ...(tool.endsWith("diagnose-emptyfile.mjs") ? ["--import", "tsx"] : []), "--input-type=module", "--eval", toolBytes.toString("utf8")];
const result = spawnSync(process.execPath, args, { cwd: snapshot, env: environment, encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 });
writeFileSync(join(supplement, "stdout"), result.stdout ?? "", { flag: "wx" });
writeFileSync(join(supplement, "stderr"), result.stderr ?? "", { flag: "wx" });
const after = boundary("after");
const summary = { startedAt, finishedAt: new Date().toISOString(), supplement, tool, evaluatedToolSha256: digest(toolBytes), wrapper: relative(repository, wrapperPath), wrapperSha256: digest(wrapperBytes), snapshot, cwd: snapshot, command: [process.execPath, ...args.slice(0, -1), "<exact captured tool.mjs bytes>"], before, after, immutable: aggregate(before) === aggregate(after), exitCode: result.status, signal: result.signal, error: result.error?.message, stdoutSha256: digest(result.stdout ?? ""), stderrSha256: digest(result.stderr ?? ""), original3758Rerun: false, revised96Rerun: false, consumer61Rerun: false };
writeFileSync(join(supplement, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(summary, null, 2));
if (result.stderr) console.error(result.stderr);
process.exitCode = result.status ?? 1;
