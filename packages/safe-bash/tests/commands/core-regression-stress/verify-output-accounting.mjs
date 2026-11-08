import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd(), owned = "tests/commands/core-regression-stress";
const revision = "f7000b05b15fa34371226b35cf537d3f73bbf004";
const temporary = mkdtempSync(join(tmpdir(), "safe-core-accounting-review-"));
const snapshot = join(temporary, "snapshot"); mkdirSync(snapshot);
const sha = value => createHash("sha256").update(value).digest("hex");
const archive = join(temporary, "source.tar");
execFileSync("git", ["archive", "-o", archive, revision, "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "tests/contracts", "tests/commands/helpers.ts", "tests/commands/execution.test.ts", "tests/commands/core-env", "tests/commands/core-expanded", "tests/shell/env-replacement.test.ts", "tests/shell/env-replacement-bounds.test.ts", "tests/shell/env-replacement-bounds.ts", "tests/shell/output-accounting.test.ts", "tests/shell/output-accounting-bounds.test.ts", "tests/shell/output-accounting-bounds.ts", "tests/shell-stress/env-replacement/native-frozen.json"], { cwd: root });
execFileSync("tar", ["-xf", archive, "-C", snapshot]);
symlinkSync(join(root, "node_modules"), join(snapshot, "node_modules"), "dir");
cpSync(join(root, owned), join(snapshot, owned), { recursive: true, filter: path => !path.includes(`${owned}/evidence`) });
function manifest(directory, prefix = "") {
  const files = {};
  for (const entry of readdirSync(join(directory, prefix), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, manifest(directory, path));
    else files[path] = sha(readFileSync(join(directory, path)));
  }
  return files;
}
const sourceBefore = manifest(join(snapshot, "src")), testsBefore = manifest(join(snapshot, "tests"));
assert.equal(sourceBefore["shell/runtime.ts"], "c7c9d02ddde5576b7810bfecbbd21b70c6eb2c0ea4fe1ee8bee92c21946d8449");
function execute(args, extra = {}) {
  const result = spawnSync(process.execPath, args, { cwd: snapshot, env: { ...process.env, CORE_AUDIT_SOURCE: snapshot }, encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024, ...extra });
  if (result.error || result.signal || result.status === null) throw result.error ?? new Error("abnormal child termination");
  return { args, status: result.status, stdout: result.stdout, stderr: result.stderr };
}
const test = files => {
  const result = execute(["--unhandled-rejections=strict", "--import", "tsx", "--test", ...files]);
  for (const label of ["tests", "pass", "fail", "skipped", "todo", "cancelled"]) result[label] = Number(result.stdout.match(new RegExp(`^# ${label} (\\d+)$`, "m"))?.[1]);
  result.failures = [...result.stdout.matchAll(/^not ok \d+ - (.*)$/gm)].map(match => match[1]);
  return result;
};
function accounting() {
  const result = execute(["--unhandled-rejections=strict", "--import", "tsx", `${owned}/env-accounting.mjs`]);
  return { ...result, report: JSON.parse(result.stdout) };
}
const independentFiles = readdirSync(join(snapshot, owned)).filter(name => name.endsWith(".test.ts")).sort().map(name => `${owned}/${name}`);
const guards = [`${owned}/output-accounting/guards.test.ts`];
const results = {
  accounting: accounting(),
  independent: test(independentFiles),
  guards: test(guards),
  runtimeAcceptance: test(["tests/commands/core-env/runtime-acceptance.test.ts"]),
  focused: test(["tests/commands/core-env/forwarding.test.ts", "tests/commands/core-env/order.test.ts", "tests/commands/execution.test.ts", "tests/commands/core-expanded/regressions.test.ts", "tests/contracts/invoke.test.ts", "tests/contracts/stdin-provenance.test.ts", "tests/shell/env-replacement.test.ts", "tests/shell/env-replacement-bounds.test.ts"]),
  authorAccounting: test(["tests/shell/output-accounting.test.ts", "tests/shell/output-accounting-bounds.test.ts"]),
};
const compile = {};
for (const [label, args] of [["selectedTypecheck", ["--noEmit", "-p", "tsconfig.json"]], ["isolatedBuild", ["-p", "tsconfig.build.json"]]]) compile[label] = execute([join(root, "node_modules/typescript/bin/tsc"), ...args]);
const runtimePath = join(snapshot, "src/shell/runtime.ts"), original = readFileSync(runtimePath, "utf8");
const mutations = [
  { name: "omit-budget-owner-check", from: "ownership?.budget === this && ownership.write === sink.write", to: "ownership && ownership.write === sink.write" },
  { name: "omit-writer-identity-check", from: "ownership?.budget === this && ownership.write === sink.write", to: "ownership?.budget === this" },
  { name: "dynamic-previously-verified-writer", from: "const write = owned ? owned.write.bind(sink) : (chunk: Uint8Array) => sink.write(chunk);", to: "const write = (chunk: Uint8Array) => sink.write(chunk);" },
  { name: "charge-only-successful-downstream-write", from: "this.bytes += chunk.byteLength;\n        await interruptible(sink.write(chunk), signal);", to: "await interruptible(sink.write(chunk), signal);\n        this.bytes += chunk.byteLength;" },
  { name: "exempt-unknown-sinks", from: "const ownership = budgetedSinks.get(sink);\n    if", to: "const ownership = budgetedSinks.get(sink);\n    if (!ownership) return signalSink(sink, signal);\n    if" },
  { name: "inflate-byte-quota", from: "chunk.byteLength > this.limits.maxOutputBytes - this.bytes", to: "chunk.byteLength > Number.MAX_SAFE_INTEGER - this.bytes" },
  { name: "deduplicate-payload-content", transform(source) {
    assert.ok(source.includes("export class Budget {\n"));
    const changed = source.replace("export class Budget {\n", "export class Budget {\n  readonly reviewSeen = new Set<string>();\n");
    const anchor = 'if (!(chunk instanceof Uint8Array)) throw new TypeError("Shell output must be Uint8Array");';
    assert.equal(changed.split(anchor).length, 2);
    return changed.replace(anchor, `${anchor}\n        const key = Buffer.from(chunk).toString("hex");\n        if (this.reviewSeen.has(key)) { await interruptible(sink.write(chunk), signal); return; }\n        this.reviewSeen.add(key);`);
  } },
];
const mutants = [];
for (const mutation of mutations) {
  if (!mutation.transform) assert.equal(original.split(mutation.from).length, 2, mutation.name);
  const changed = mutation.transform ? mutation.transform(original) : original.replace(mutation.from, mutation.to);
  writeFileSync(runtimePath, changed);
  try {
    const guardResult = test(guards), accountingResult = accounting();
    assert.equal(guardResult.tests, 8, "all guard cases must execute");
    assert.equal(accountingResult.report.totals.cases, 18, "all unchanged accounting cases must execute");
    const budgetFailures = accountingResult.report.observed.filter(row => row.id !== "entry-order-raw-control" && !row.pass).map(row => row.id);
    mutants.push({ name: mutation.name, runtimeSha256: sha(changed), detected: guardResult.fail > 0 || budgetFailures.length > 0, budgetFailures, guards: guardResult, accounting: accountingResult.report });
  } finally { writeFileSync(runtimePath, original); }
}
const sourceAfter = manifest(join(snapshot, "src")), testsAfter = manifest(join(snapshot, "tests"));
assert.deepEqual(sourceAfter, sourceBefore); assert.deepEqual(testsAfter, testsBefore);
const report = { capturedAt: new Date().toISOString(), revision, archiveSha256: sha(readFileSync(archive)), snapshot, node: process.version,
  sourceBefore, sourceAfter, testsBefore, testsAfter, results, compile, mutants,
  classification: { orderOnlyFailures: results.accounting.report.observed.filter(row => row.id === "entry-order-raw-control" && !row.pass).length, budgetFailures: results.accounting.report.observed.filter(row => row.id !== "entry-order-raw-control" && !row.pass).length },
  scope: "Complete committed f7000b0 source; unchanged core100 and accounting18 recipes. Eight new same-family guard tests. Mutants alter only isolated temporary runtime.ts and require all26 cases to complete. No author or prior expected values changed; one strict Apple ordering difference remains a failure." };
console.log(JSON.stringify(report, null, 2));
if (report.classification.orderOnlyFailures !== 1 || report.classification.budgetFailures !== 0 || results.accounting.status !== 1 || Object.entries(results).filter(([name]) => name !== "accounting").some(([, result]) => result.status !== 0) || Object.values(compile).some(result => result.status !== 0) || mutants.some(result => !result.detected)) process.exitCode = 1;
