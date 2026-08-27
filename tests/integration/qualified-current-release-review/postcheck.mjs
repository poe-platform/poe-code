import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repository = "/Users/kjopek/Workspace/safe-bash";
const owner = join(repository, "tests/integration/qualified-current-release-review");
const evidence = join(owner, "execution-evidence");
const work = join(owner, ".execution-work");
const summary = JSON.parse(readFileSync(join(evidence, "execution-summary.json")));
const report = JSON.parse(readFileSync(join(evidence, "positive/result.json")));
const patch = execFileSync("/usr/bin/which", ["apply_patch"], { encoding: "utf8" }).trim();
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const saveText = (path, text) => {
  assert.equal(existsSync(path), false, `never overwrite evidence: ${path}`);
  execFileSync(patch, [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${path}\n${text.replace(/\n$/u, "").split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`, maxBuffer: 4 * 1024 * 1024 });
};
const save = (name, value) => saveText(join(evidence, name), JSON.stringify(value, null, 2) + "\n");
const environment = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LC_ALL: "C", LANG: "C", TZ: "UTC" };
const consumer = join(summary.location, "consumer");
const installed = join(consumer, "node_modules/virtual-bash");
const compiler = join(repository, "node_modules/typescript/bin/tsc");
const originalGroup = report.currentConsumers.groups.find(group => group.name === "webdav-loopback");
const controls = [];
for (const name of ["missing-dist", "missing-declaration", "intended-type-error"]) {
  const workspace = join(work, "independent-controls", name);
  const target = join(workspace, "node_modules/virtual-bash");
  mkdirSync(target, { recursive: true });
  saveText(join(target, "package.json"), readFileSync(join(installed, "package.json"), "utf8"));
  if (name !== "missing-dist") cpSync(join(installed, "dist"), join(target, "dist"), { recursive: true, filter: path => name !== "missing-declaration" || path !== join(installed, "dist/index.d.ts") });
  saveText(join(workspace, "package.json"), '{"type":"module","private":true}\n');
  const files = originalGroup.inputs.map(input => {
    const filename = input.path.split("/").at(-1);
    const bytes = readFileSync(input.target, "utf8");
    assert.equal(digest(bytes), input.sha256);
    const targetPath = join(workspace, filename);
    saveText(targetPath, bytes + (name === "intended-type-error" && filename === "consumer.test.mts" ? '\nconst independentReleaseTypeControl: number = "must fail";\n' : ""));
    return { path: targetPath, originalPath: input.path, originalSha256: input.sha256, sha256: digest(readFileSync(targetPath)) };
  });
  const config = JSON.parse(readFileSync(join(report.root, "tests/plugins/qualified-current-release/tsconfig.consumer.json")));
  config.compilerOptions.noEmit = true;
  config.compilerOptions.typeRoots = [join(repository, "node_modules/@types")];
  config.files = files.map(input => input.path);
  saveText(join(workspace, "tsconfig.json"), JSON.stringify(config, null, 2) + "\n");
  const command = [process.execPath, compiler, "-p", join(workspace, "tsconfig.json"), "--listFiles"];
  const result = spawnSync(command[0], command.slice(1), { cwd: workspace, env: environment, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  const record = { name, command, cwd: workspace, environment, files, config, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  save(`types-${name}.json`, record);
  assert.equal(result.signal, null);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  if (name === "intended-type-error") {
    assert.match(result.stdout, /consumer\.test\.mts\(\d+,\d+\): error TS2322: Type 'string' is not assignable to type 'number'/u);
    assert.equal((result.stdout.match(/error TS\d+:/gu) ?? []).length, 1);
    assert.ok(result.stdout.includes(join(target, "dist/index.d.ts")));
  } else assert.match(result.stdout, name === "missing-dist" ? /error TS2307:/u : /error TS7016:/u);
  assert.ok(!result.stdout.split("\n").some(line => line.startsWith(join(repository, "src/")) || line.startsWith(join(report.root, "src/"))));
  controls.push({ name, passed: true, status: result.status, errors: [...new Set(result.stdout.match(/TS\d+/gu))], originalFilesUnchanged: originalGroup.inputs.every(input => digest(readFileSync(input.target)) === input.sha256) });
}
save("independent-type-controls.json", { source: report.sourceCommit, controls, inputDelta: 'Only copied consumer.test.mts receives the frozen line: const independentReleaseTypeControl: number = "must fail";', sourceDenied: JSON.parse(readFileSync(join(evidence, "positive/current-consumer-source-denied.json"))), harnessSha256: digest(readFileSync(new URL(import.meta.url))) });
const otherStage = "/private/tmp/safe-bash-current-webdav-consumer-blocker-stage-lXZn5P";
const otherFiles = {
  "v2-baseline-canonical-path.json": "2456c05a349fe5391bb4bcf98018bcdb7c7a9ef2f7b10887346d9ee39b837ddc",
  "v2-protocol-controls.json": "545787c89c5b3a7312741af9127b0b39ee4e57ee782f23f772d24767ccbee201",
  "v2-owned-copy-consumer-diagnostic.json": "6c622dbaba65a3b5325c7bcae8aaa7eb596070264ccbbf5f682de6686ba2b676",
  "baseline.json": null,
  "protocol-controls.json": null,
  "v2-diagnostic-summary.json": null,
};
const provenance = [];
for (const [name, expected] of Object.entries(otherFiles)) {
  const origin = join(otherStage, name);
  const bytes = readFileSync(origin);
  if (expected) assert.equal(digest(bytes), expected);
  const target = join(evidence, "other-agent-webdav", name);
  saveText(target, bytes.toString());
  assert.equal(digest(readFileSync(target)), digest(bytes));
  provenance.push({ origin, archivedPath: target.slice(repository.length + 1), sha256: digest(bytes), expectedSha256: expected, provenance: "Read-only investigator76944; f12141d candidate diagnostic, NOT this leaf's execution or current02 input coverage. Diagnostic provider never overlaid onto candidate." });
}
save("other-agent-webdav/provenance.json", provenance);
console.log(JSON.stringify({ independentTypeControls: controls, otherAgentFilesArchived: provenance.length }));
