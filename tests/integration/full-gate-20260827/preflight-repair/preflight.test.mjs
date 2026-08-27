import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { assessNative, assessRepository, digest, launchAfterPreflight, policy, requireAdmission, stageNative, verifyNativeStaging } from "./preflight.mjs";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();

async function fixture(body) {
  const root = mkdtempSync(join(tmpdir(), "safe-bash-preflight-control-"));
  try {
    git(root, "init", "--quiet");
    mkdirSync(join(root, "tests")); mkdirSync(join(root, "src"));
    writeFileSync(join(root, "tests/control.test.ts"), "export {};\n");
    writeFileSync(join(root, "src/control.ts"), "export {};\n");
    git(root, "add", "--", "tests/control.test.ts", "src/control.ts");
    git(root, "-c", "user.name=preflight-control", "-c", "user.email=preflight@invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "isolated control");
    const candidate = git(root, "rev-parse", "HEAD");
    const native = join(root, "native-control"); writeFileSync(native, "native fixture bytes\n"); chmodSync(native, 0o755);
    const profile = {
      candidate, platform: process.platform, arch: process.arch, scope: "unit fixture, never a product gate",
      canonicalFiles: ["tests/control.test.ts"],
      scopeInputs: [{ path: "src/control.ts", blob: git(root, "rev-parse", "HEAD:src/control.ts"), mode: "100644" }],
      historicalBindings: [{ path: "src/control.ts", expected: digest(readFileSync(join(root, "src/control.ts"))), guard: "control" }],
      blockedWriters: [], native: [{ name: "control", origin: native, sha256: digest(readFileSync(native)), executable: true, target: "snapshot:oracle/control" }],
      environment: { GNU_TABLE_BIN: "$SNAPSHOT/oracle", STREAM_NATIVE_LIVE: "1" },
    };
    await body({ root, candidate, native, profile, assess: () => assessRepository({ repository: root, candidate, profile }) });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("admitted control launches exactly once and stages authenticated regular bytes", async () => fixture(async ({ root, assess }) => {
  const report = assess(); requireAdmission(report);
  let launches = 0;
  await launchAfterPreflight(report, () => { launches++; }); assert.equal(launches, 1);
  const snapshot = join(root, "snapshot"), nativeRoot = join(root, "native-bin"), environment = {};
  mkdirSync(snapshot); mkdirSync(nativeRoot);
  const staged = stageNative(report, { snapshot, nativeRoot, environment });
  assert.equal(staged.length, 1); assert.equal(digest(readFileSync(staged[0].target)), staged[0].sha256);
  verifyNativeStaging(staged);
  assert.equal(environment.GNU_TABLE_BIN, join(snapshot, "oracle")); assert.equal(environment.STREAM_NATIVE_LIVE, "1");
}));

test("deleted staged executable refuses the final pre-suite check", async () => fixture(async ({ root, assess }) => {
  const snapshot = join(root, "snapshot"), nativeRoot = join(root, "native-bin"); mkdirSync(snapshot); mkdirSync(nativeRoot);
  const staged = stageNative(assess(), { snapshot, nativeRoot, environment: {} }); rmSync(staged[0].target);
  assert.throws(() => verifyNativeStaging(staged), { code: "ENOENT" });
}));

test("all seven originally omitted GNU executables materialize at their actual fixture paths", () => {
  const names = ["nl", "seq", "unexpand", "split", "date", "sleep", "printenv"];
  const requirements = policy.native.filter(asset => names.includes(asset.name));
  assert.equal(requirements.length, names.length);
  const native = assessNative(requirements, repository); assert.deepEqual(native.issues, []);
  const temporary = mkdtempSync(join(tmpdir(), "safe-bash-preflight-native-only-"));
  try {
    const snapshot = join(temporary, "snapshot"), nativeRoot = join(temporary, "native"); mkdirSync(snapshot); mkdirSync(nativeRoot);
    const staged = stageNative({ issues: [], status: "preflight-admitted-not-product-acceptance", native, environment: {}, scope: "native materialization only, not candidate admission" }, { snapshot, nativeRoot, environment: {} });
    verifyNativeStaging(staged);
    for (const asset of staged) {
      assert.equal(asset.target, join(snapshot, "tests/commands/metadata-stress/.oracle/coreutils-9.7/src", asset.name));
      const result = spawnSync(asset.target, ["--version"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 5000 });
      assert.equal(result.status, 0); assert.equal(result.stdout.split("\n")[0], `${asset.name} (GNU coreutils) 9.7`);
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

for (const fault of ["missing", "wrong-bytes", "not-executable", "symlink"]) {
  test(`native ${fault} rejects before launch`, async () => fixture(async ({ root, native, profile, assess }) => {
    if (fault === "missing") rmSync(native);
    if (fault === "wrong-bytes") writeFileSync(native, "different");
    if (fault === "not-executable") chmodSync(native, 0o644);
    if (fault === "symlink") { const link = join(root, "linked-native"); symlinkSync(native, link); profile.native[0].origin = link; }
    const report = assess(); assert.ok(report.issues.some(row => row.kind === "native-unavailable-or-mismatched"));
    let launched = false;
    await assert.rejects(launchAfterPreflight(report, () => { launched = true; })); assert.equal(launched, false);
  }));
}

test("missing mandatory opt-in environment is refusal, not a skip", () => {
  const result = assessNative([{ name: "tree", originEnv: "TREE_NATIVE_BIN", sha256: "0".repeat(64) }], repository, {});
  assert.equal(result.issues[0].kind, "native-unavailable"); assert.equal(result.assets.length, 0);
});

for (const staged of [false, true]) {
  test(`dirty tracked artifact rejects before launch (${staged ? "index" : "worktree"})`, async () => fixture(async ({ root, assess }) => {
    writeFileSync(join(root, "tests/control.test.ts"), "changed evidence\n");
    if (staged) git(root, "add", "--", "tests/control.test.ts");
    const report = assess(); assert.ok(report.issues.some(row => row.kind === "dirty-tracked-inputs"));
    let launched = false; await assert.rejects(launchAfterPreflight(report, () => { launched = true; })); assert.equal(launched, false);
  }));
}

test("foreign untracked preparation alone is not silently included or deleted", async () => fixture(async ({ root, assess }) => {
  writeFileSync(join(root, "foreign-preparation"), "preserve"); requireAdmission(assess());
  assert.equal(readFileSync(join(root, "foreign-preparation"), "utf8"), "preserve");
}));

for (const fault of ["historical-binding", "known-writer", "changed-writer", "canonical-discovery", "source-scope", "host-profile"]) {
  test(`${fault} rejects before launch`, async () => fixture(async ({ profile, assess }) => {
    if (fault === "historical-binding") profile.historicalBindings[0].expected = "0".repeat(64);
    if (fault.endsWith("writer")) profile.blockedWriters.push({ path: "src/control.ts", sha256: fault === "known-writer" ? profile.historicalBindings[0].expected : "0".repeat(64), target: "sealed.json" });
    if (fault === "canonical-discovery") profile.canonicalFiles = [];
    if (fault === "source-scope") profile.scopeInputs[0].blob = "0".repeat(40);
    if (fault === "host-profile") profile.arch = "unreviewed";
    const report = assess(); assert.ok(report.issues.length);
    let launched = false; await assert.rejects(launchAfterPreflight(report, () => { launched = true; })); assert.equal(launched, false);
  }));
}

test("unknown commit is rejected without reading a repository or executing a suite", () => {
  const report = assessRepository({ repository: "/does-not-exist", candidate: "f".repeat(40), profile: policy });
  assert.equal(report.issues[0].kind, "unreviewed-candidate"); assert.throws(() => requireAdmission(report));
});

test("native change between admission and staging publishes no staged binary", async () => fixture(async ({ root, native, assess }) => {
  const report = assess(); requireAdmission(report); writeFileSync(native, "changed later");
  const snapshot = join(root, "snapshot"), nativeRoot = join(root, "native-bin"); mkdirSync(snapshot); mkdirSync(nativeRoot);
  assert.throws(() => stageNative(report, { snapshot, nativeRoot, environment: {} }), /changed after admission/);
  assert.equal(existsSync(join(snapshot, "oracle/control")), false);
}));

test("staging path escape is rejected before publishing a binary", async () => fixture(async ({ root, profile, assess }) => {
  profile.native[0].target = "snapshot:../escape";
  const report = assess(); const snapshot = join(root, "snapshot"); mkdirSync(snapshot);
  assert.throws(() => stageNative(report, { snapshot, nativeRoot: join(root, "native-bin"), environment: {} }), /owned root/);
  assert.equal(existsSync(join(root, "escape")), false);
}));

test("root executable rejects an unreviewed candidate before creating output", () => {
  const output = join(tmpdir(), `full-gate-forbidden-preflight-${process.pid}`); assert.equal(existsSync(output), false);
  const result = spawnSync(process.execPath, ["scripts/verify-whole-gate.mjs", "--handoff", "f".repeat(40), "--execute", output], { cwd: repository, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 78); assert.match(result.stdout, /unreviewed-candidate/); assert.equal(existsSync(output), false);
});

for (const failure of ["missing", "changed", "nonexecutable"]) {
  test(`both public routes return78 before launcher import for ${failure} mandatory native`, async () => fixture(async ({ root, candidate, native, profile }) => {
    const directory = join(root, "tests/integration/full-gate-20260827/preflight-repair");
    mkdirSync(directory, { recursive: true }); mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts/verify-whole-gate.mjs"), readFileSync(join(repository, "scripts/verify-whole-gate.mjs")));
    writeFileSync(join(directory, "preflight.mjs"), readFileSync(new URL("./preflight.mjs", import.meta.url)));
    writeFileSync(join(directory, "policy.json"), JSON.stringify(profile));
    const sentinel = join(root, "forbidden-launcher-import");
    writeFileSync(join(directory, "run.mjs"), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'forbidden');`);
    if (failure === "missing") rmSync(native);
    else if (failure === "changed") writeFileSync(native, "changed bytes");
    else chmodSync(native, 0o644);
    for (const suffix of [["--preflight-only"], ["--execute", join(root, "forbidden-output")]]) {
      const result = spawnSync(process.execPath, ["scripts/verify-whole-gate.mjs", "--handoff", candidate, ...suffix], { cwd: root, encoding: "utf8", timeout: 10000 });
      assert.equal(result.status, 78, result.stderr); assert.equal(result.stderr, "");
      const report = JSON.parse(result.stdout); assert.equal(report.suiteLaunched, false);
      assert.equal(report.issues.length, 1); assert.equal(report.issues[0].kind, "native-unavailable-or-mismatched");
      assert.equal(existsSync(sentinel), false); assert.equal(existsSync(join(root, "forbidden-output")), false);
    }
  }));
}

for (const mutant of ["bypass-admission", "drop-native-issues"]) {
  test(`negative control kills ${mutant} mutant using a sentinel, never a product suite`, async () => fixture(async ({ root, candidate, native, profile }) => {
    const source = readFileSync(new URL("./preflight.mjs", import.meta.url), "utf8");
    const changed = mutant === "bypass-admission"
      ? source.replace(/export function requireAdmission\(report\) \{[\s\S]*?\n\}/u, "export function requireAdmission(report) {}")
      : source.replace("report.issues.push(...report.native.issues);", "");
    assert.notEqual(changed, source);
    const path = join(root, "mutant.mjs"); writeFileSync(path, changed); writeFileSync(join(root, "policy.json"), JSON.stringify(profile));
    const module = await import(pathToFileURL(path).href); rmSync(native);
    const report = module.assessRepository({ repository: root, candidate, profile });
    let launched = false;
    await module.launchAfterPreflight(report, () => { launched = true; });
    assert.equal(launched, true, "mutant must exhibit the forbidden sentinel launch that the original rejects");
  }));
}
