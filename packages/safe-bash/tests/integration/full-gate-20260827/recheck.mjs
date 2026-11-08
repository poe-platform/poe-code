import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hash, repository } from "./inspect.mjs";
import { account } from "./account.mjs";
import { supervise } from "./supervise.mjs";

const baseline = JSON.parse(readFileSync(process.argv[2], "utf8")), output = process.argv[3];
assert.equal(baseline.revision, "e36dab2b6abc216ddc89e5786a0eba76f08a1722");
assert.ok(output.startsWith("/tmp/full-gate-") && !existsSync(output)); mkdirSync(output);
const root = realpathSync(mkdtempSync("/tmp/full-gate-recheck-")), source = join(root, "source");
for (const path of [source, join(root, "home"), join(root, "tmp"), join(root, "native-bin")]) mkdirSync(path);
const report = { revision: baseline.revision, baselineArchiveSha256: baseline.archiveSha256, scope: "Separate bounded diagnostics, not a replacement canonical gate or relaxed assertion", startedAt: new Date().toISOString(), phases: [], source, root };
const environment = { PATH: `${join(root, "native-bin")}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: join(root, "home"), TMPDIR: join(root, "tmp"), LANG: "C", LC_ALL: "C", TZ: "UTC", TSX_DISABLE_CACHE: "1", RIPGREP_CONFIG_PATH: "", NO_COLOR: "1" };
const save = () => writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
function checkInputs() {
  for (const [path, expected] of Object.entries(baseline.sourceHashes)) {
    const filename = join(source, path), info = lstatSync(filename);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1);
    assert.equal(hash(readFileSync(filename)), expected.sha256, path);
    assert.equal(info.mode & 0o777, expected.mode, path);
  }
}
async function phase(label, args, guarded = false, test = false) {
  const env = { ...environment, ...(guarded ? { FULL_GATE_ROOT: root, FULL_GATE_TOOL_ROOTS: "[]", FULL_GATE_IMPORTS: join(output, "imports", label), NODE_OPTIONS: "--import=" + pathToFileURL(join(root, "import-guard.mjs")).href } : {}) };
  const result = await supervise(process.execPath, args, { cwd: source, env, timeoutMs: 90000, stdout: join(output, label + ".stdout.log"), stderr: join(output, label + ".stderr.log"), observeSockets: true });
  Object.assign(result, { label, guarded, ...(test ? { accounting: account(readFileSync(join(output, label + ".stdout.log"), "utf8")) } : {}) });
  report.phases.push(result); checkInputs(); save();
}
try {
  const archive = join(root, "source.tar");
  execFileSync("git", ["archive", "-o", archive, baseline.revision], { cwd: repository, timeout: 180000 });
  assert.equal(hash(readFileSync(archive)), baseline.archiveSha256);
  execFileSync("tar", ["-xf", archive, "-C", source], { timeout: 180000 }); checkInputs();
  for (const [path, expected] of Object.entries(baseline.dependencies.root.files)) {
    const bytes = readFileSync(join(repository, "node_modules", path)); assert.equal(hash(bytes), expected.sha256);
    const target = join(source, "node_modules", path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); chmodSync(target, expected.mode);
  }
  const rg = readFileSync(baseline.native.rg.resolved); assert.equal(hash(rg), baseline.native.rg.sha256);
  writeFileSync(join(root, "native-bin/rg"), rg); chmodSync(join(root, "native-bin/rg"), 0o755);
  const guard = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "import-guard.mjs"));
  assert.equal(hash(guard), baseline.harnessHashes["import-guard.mjs"]); writeFileSync(join(root, "import-guard.mjs"), guard);
  report.dependencyPolicy = "Every copied root development file matches first-run hashes. No .bin or benchmark tools required by these selected original test files. Node invokes compiler/tsx directly.";
  report.loadBefore = execFileSync("/usr/bin/uptime", { encoding: "utf8" }).trim();
  await phase("build", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"]);
  await phase("global-after-build", ["node_modules/typescript/bin/tsc", "--noEmit"]);
  const selected = [
    ["jq-scan-plain", "tests/commands/structured-stress/jq-grammar-author-20260827/scan-boundaries.test.ts", false],
    ["jq-scan-guarded", "tests/commands/structured-stress/jq-grammar-author-20260827/scan-boundaries.test.ts", true],
    ...[1, 2, 3].map(index => [`rg-stream-plain-${index}`, "tests/commands/search-stress/streaming.test.ts", false]),
    ["shell-first-read-plain", "tests/shell/remote-close.test.ts", false],
    ["diff-emptyfile-plain", "tests/commands/diff-patch-stress/emptyfile-delta/emptyfile.test.ts", false],
  ];
  for (const [label, file, guarded] of selected) await phase(label, ["--import", "tsx", "--test", file], guarded, true);
  report.loadAfter = execFileSync("/usr/bin/uptime", { encoding: "utf8" }).trim(); report.inputsUnchanged = true;
  report.status = "captured";
} catch (error) { report.status = "infrastructure-failed"; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  rmSync(root, { recursive: true, force: true }); report.temporaryRemoved = !existsSync(root); report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, error: report.error, phases: report.phases.map(({ label, status, clean, accounting }) => ({ label, status, clean, counts: accounting?.counts, reconciled: accounting?.reconciled })), temporaryRemoved: report.temporaryRemoved }, null, 2));
}
