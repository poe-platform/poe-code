import assert from "node:assert/strict";
import * as childProcess from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync, chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync,
  mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync,
  rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const candidate = "8784a8fc0484313b914fe1ae6db33a8cfd0e0be4";
const nativeHash = "90b9c9257095110594ae58a4bb1531d9670bd6aed297b8dbf0dc01914c5de09f";
const goldenHash = "e00ba3920f79dcb4ef58d0a19242e07d1de6bd1698c66c56c0a27bb5eabb1d72";
const stderrHash = "408835816cfd774536a0bffae5ade7814e96e2e8e4091618b47bb5edfd796705";
const originalExecutable = "/tmp/safe-bash-gnu-strings-20260827-YJqPHf/build-system-zlib/binutils/strings";
const modulePath = fileURLToPath(import.meta.url);
const owned = dirname(modulePath);
const repository = resolve(owned, "../../../..");
const streamDirectory = "tests/commands/stream-inspection";
const goldenPath = `${streamDirectory}/evidence/gnu-strings.json`;
const selectedPaths = ["src", streamDirectory, "package.json"];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const hashFile = filename => sha256(readFileSync(filename));
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function namespace(directory) {
  const entries = [];
  function visit(folder) {
    for (const name of readdirSync(folder).sort()) {
      const filename = join(folder, name);
      const details = lstatSync(filename);
      const entry = { path: relative(directory, filename), mode: details.mode & 0o777 };
      if (details.isSymbolicLink()) entries.push({ ...entry, type: "symlink", target: readlinkSync(filename) });
      else if (details.isDirectory()) {
        entries.push({ ...entry, type: "directory" });
        visit(filename);
      } else {
        assert.ok(details.isFile(), `unexpected filesystem kind: ${filename}`);
        entries.push({ ...entry, type: "file", size: details.size, sha256: hashFile(filename) });
      }
    }
  }
  visit(directory);
  return { sha256: sha256(json(entries)), entries };
}

function fingerprint(filename) {
  return { executable: filename, resolved: realpathSync(filename), sha256: hashFile(filename), mode: lstatSync(filename).mode & 0o777 };
}

function patchFiles(files, cwd) {
  const input = "*** Begin Patch\n" + Object.entries(files).map(([filename, text]) => {
    assert.ok(text.endsWith("\n"));
    return `*** Add File: ${filename}\n${text.slice(0, -1).split("\n").map(line => `+${line}`).join("\n")}\n`;
  }).join("") + "*** End Patch\n";
  childProcess.execFileSync("apply_patch", [], { cwd, input, maxBuffer: 16 * 1024 * 1024 });
}

function installNativeAudit() {
  const invoke = childProcess.spawnSync;
  const executable = process.env.STREAM_GNU_STRINGS;
  const auditFile = join(process.env.ARGV0_REVIEW_AUDIT_DIRECTORY, `${process.pid}.ndjson`);
  const record = entry => appendFileSync(auditFile, `${JSON.stringify(entry)}\n`);
  const mutable = childProcess.default;
  mutable.spawnSync = function auditedSpawnSync(selected, args, options = {}) {
    assert.equal(selected, executable, "no original-path fallback or substitute executable is permitted");
    const before = fingerprint(selected);
    assert.equal(before.sha256, nativeHash);
    const filesBefore = options.cwd ? namespace(options.cwd) : null;
    const result = invoke(selected, args, options);
    const after = fingerprint(selected);
    const filesAfter = options.cwd ? namespace(options.cwd) : null;
    record({
      kind: "spawnSync", parentPid: process.pid, childPid: result.pid,
      selected, args, argv0Present: Object.hasOwn(options, "argv0"), argv0: options.argv0 ?? null,
      cwd: options.cwd ?? null, env: options.env,
      inputHex: options.input ? Buffer.from(options.input).toString("hex") : "",
      before, after, filesBefore, filesAfter,
      status: result.status, signal: result.signal, error: result.error?.message ?? null,
      stdoutBytes: Buffer.byteLength(result.stdout ?? ""), stderrBytes: Buffer.byteLength(result.stderr ?? ""),
      stdoutSha256: sha256(result.stdout ?? ""), stderrSha256: sha256(result.stderr ?? ""),
    });
    assert.deepEqual(after, before);
    assert.deepEqual(filesAfter, filesBefore, "native strings must not mutate input files or create entries");
    return result;
  };
  syncBuiltinESMExports();
  record({ kind: "audit-start", pid: process.pid, argv: process.argv });
  process.on("exit", code => record({ kind: "audit-exit", pid: process.pid, code }));
}

async function controls() {
  installNativeAudit();
  const tree = process.env.ARGV0_REVIEW_TREE;
  const executable = process.env.STREAM_GNU_STRINGS;
  const load = filename => import(pathToFileURL(join(tree, streamDirectory, filename)).href);
  const { capture, identity } = await load("oracle.ts");
  const { captureGnuStrings, defaultStrings } = await load("gnu-strings-oracle.ts");
  const { gnuStringsCases } = await load("gnu-strings-cases.ts");
  const evidence = JSON.parse(readFileSync(join(tree, goldenPath), "utf8"));
  const specimen = id => gnuStringsCases.find(item => item.id === id);
  const golden = id => evidence.observations.find(item => item.id === id);
  const results = [];
  const originalFixtureBytes = json(gnuStringsCases);
  const baseline = namespace(tree);
  async function check(name, action) {
    const details = await action();
    assert.equal(json(gnuStringsCases), originalFixtureBytes, "original fixture definitions remain unchanged");
    assert.deepEqual(namespace(tree), baseline, "helper scratch must be completely removed after each control");
    results.push({ name, status: "pass", ...details });
  }
  const lone = specimen("gnu-lone-dash-stdin");
  const expected = golden(lone.id);
  let wrong;
  await check("bound-real-native-matches-all-1564-original-stderr-bytes", () => {
    const observed = capture(lone, executable, defaultStrings);
    assert.equal(defaultStrings, originalExecutable);
    assert.deepEqual(observed, expected);
    const bytes = Buffer.from(observed.stderrHex, "hex");
    assert.equal(bytes.length, 1564);
    assert.equal(sha256(bytes), stderrHash);
    return { observation: observed, stderrBytes: bytes.length, stderrSha256: sha256(bytes) };
  });
  await check("wrong-argv0-staged-path-reproduces-original-strict-mismatch", () => {
    wrong = capture(lone, executable, executable);
    let mismatch;
    try { assert.deepEqual(wrong, expected); } catch (error) { mismatch = error; }
    assert.ok(mismatch instanceof assert.AssertionError);
    assert.equal(mismatch.operator, "deepStrictEqual");
    for (const key of Object.keys(expected).filter(key => key !== "stderrHex")) assert.deepEqual(wrong[key], expected[key]);
    assert.notEqual(wrong.stderrHex, expected.stderrHex);
    assert.ok(Buffer.from(wrong.stderrHex, "hex").toString().startsWith(`Usage: ${executable} [option(s)] [file(s)]`));
    return { wrongArgv0: executable, observation: wrong, mismatchCode: mismatch.code, mismatchOperator: mismatch.operator, mismatchMessage: mismatch.message };
  });
  await check("omitted-argv0-remains-executable-default-not-logical-fixture-path", () => {
    const omitted = capture(lone, executable);
    const direct = childProcess.spawnSync(executable, lone.args, {
      input: Buffer.from(lone.stdinHex, "hex"), timeout: 5000, maxBuffer: 8 * 1024 * 1024,
      env: { LC_ALL: "C", LANG: "C", TZ: "UTC", PATH: "/usr/bin:/bin" },
    });
    assert.ifError(direct.error);
    assert.deepEqual(omitted, wrong);
    assert.equal(omitted.status, direct.status);
    assert.equal(omitted.signal, direct.signal);
    assert.equal(omitted.stdoutHex, direct.stdout.toString("hex"));
    assert.equal(omitted.stderrHex, direct.stderr.toString("hex"));
    return { observation: omitted, directSpawnHadNoArgv0Option: true };
  });
  await check("nonexistent-logical-argv0-is-not-an-executed-fallback", () => {
    const logical = join(process.env.ARGV0_REVIEW_WORK, "never-created-logical-path", "strings");
    assert.equal(existsSync(logical), false);
    const observed = capture(lone, executable, logical);
    assert.equal(observed.status, 1);
    assert.equal(observed.signal, null);
    assert.equal(observed.stdoutHex, "");
    assert.ok(Buffer.from(observed.stderrHex, "hex").toString().startsWith(`Usage: ${logical} [option(s)] [file(s)]`));
    assert.equal(existsSync(logical), false);
    return { logical, observation: observed };
  });
  await check("original-positive-file-label-and-stdin-selection", () => {
    const observed = capture(specimen("gnu-file-hex-label"), executable, defaultStrings);
    assert.deepEqual(observed, golden("gnu-file-hex-label"));
    assert.equal(Buffer.from(observed.stdoutHex, "hex").toString(), "data:       1 ab\tcd\ndata:       7 ef\n");
    return { observation: observed };
  });
  await check("original-dash-file-operands-preserve-order-and-exclude-stdin", () => {
    const observed = capture(specimen("gnu-lone-dash-files"), executable, defaultStrings);
    assert.deepEqual(observed, golden("gnu-lone-dash-files"));
    assert.equal(Buffer.from(observed.stdoutHex, "hex").toString(), "ABCD\nEFGH\n");
    return { observation: observed };
  });
  await check("original-stdin-label-and-offsets", () => {
    const observed = capture(specimen("gnu-stdin-octal"), executable, defaultStrings);
    assert.deepEqual(observed, golden("gnu-stdin-octal"));
    assert.equal(Buffer.from(observed.stdoutHex, "hex").toString(), "{standard input}:       1 ab\n{standard input}:       5 cd\n");
    return { observation: observed };
  });
  await check("independent-space-and-leading-dash-filenames-remain-literal", () => {
    const extra = {
      id: "review-literal-labels", command: "strings",
      args: ["--all", "--print-file-name", "--radix=x", "--bytes=4", "--", "report has spaces.bin", "--leading.bin"],
      stdinHex: Buffer.from("DO-NOT-READ-STDIN").toString("hex"),
      files: { "report has spaces.bin": "00414c50484100", "--leading.bin": "00004245544100" },
    };
    const before = json(extra);
    const observed = capture(extra, executable, defaultStrings);
    assert.equal(observed.status, 0);
    assert.equal(observed.signal, null);
    assert.equal(observed.stderrHex, "");
    assert.equal(Buffer.from(observed.stdoutHex, "hex").toString(), "report has spaces.bin:       1 ALPHA\n--leading.bin:       2 BETA\n");
    assert.equal(json(extra), before);
    return { fixture: extra, observation: observed };
  });
  await check("explicit-identity-retains-staged-executable-resolved-path-and-hash", () => {
    const details = identity(executable);
    assert.equal(details.executable, executable);
    assert.equal(details.resolved, realpathSync(executable));
    assert.equal(details.sha256, nativeHash);
    assert.notEqual(details.executable, defaultStrings);
    assert.notEqual(details.resolved, realpathSync(originalExecutable));
    assert.equal(details.versionStatus, 0);
    assert.equal(details.versionStderr, "");
    assert.ok(details.version.startsWith("GNU strings (GNU Binutils) 2.44\n"));
    return { identity: details };
  });
  await check("aggregate-identity-and-entire-original-native-cohort", () => {
    const observed = captureGnuStrings();
    assert.equal(observed.identity.executable, executable);
    assert.equal(observed.identity.resolved, realpathSync(executable));
    assert.equal(observed.identity.sha256, nativeHash);
    assert.equal(observed.observations.length, 13);
    assert.deepEqual(observed.observations, evidence.observations);
    return { identity: observed.identity, count: observed.observations.length, observationIds: observed.observations.map(item => item.id) };
  });
  process.stdout.write(json({ controls: results, pass: results.length, fail: 0, skip: 0 }));
}

async function driver() {
  assert.equal(process.version, "v22.22.2");
  const started = new Date();
  const commands = [];
  const temporary = mkdtempSync("/tmp/strings-binding-independent-");
  const outputName = `run-${started.toISOString().replace(/[:.]/gu, "-")}`;
  const output = join(owned, outputName);
  assert.equal(existsSync(output), false);
  const report = { candidate, started: started.toISOString(), temporary, output, selectedPaths, passed: false };
  const artifacts = {};
  const groups = [];
  function command(executable, args, options = {}) {
    const result = childProcess.spawnSync(executable, args, {
      cwd: repository, timeout: 60000, maxBuffer: 32 * 1024 * 1024, ...options,
    });
    if (options.detached && result.pid) groups.push(result.pid);
    commands.push({ executable, args, cwd: options.cwd ?? repository, envOverrides: options.recordEnv ?? {},
      status: result.status, signal: result.signal, error: result.error?.message ?? null,
      pid: result.pid, stdoutSha256: sha256(result.stdout ?? ""), stderr: String(result.stderr ?? "") });
    if (result.error && options.detached && result.pid) {
      try { process.kill(-result.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    assert.ifError(result.error);
    assert.equal(result.status, 0, String(result.stderr));
    assert.equal(result.signal, null);
    return result.stdout;
  }
  const git = args => command("git", args);
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } };
  let before;
  let moved;
  let archive;
  let nativeBefore;
  let toolBefore;
  try {
    assert.equal(String(git(["rev-parse", "--show-toplevel"])).trim(), repository);
    report.liveBefore = { head: String(git(["rev-parse", "HEAD"])).trim(),
      status: String(git(["status", "--short", "--untracked-files=all"])), index: String(git(["diff", "--cached", "--name-status"])) };
    report.candidateTree = String(git(["rev-parse", `${candidate}^{tree}`])).trim();
    report.candidateCommitSha256 = sha256(git(["cat-file", "commit", candidate]));
    report.authorNote = { path: "/tmp/strings-binding-author-candidate.txt", sha256: hashFile("/tmp/strings-binding-author-candidate.txt") };
    nativeBefore = fingerprint(originalExecutable);
    assert.equal(nativeBefore.sha256, nativeHash);
    report.originalNativeBefore = nativeBefore;
    report.versions = { node: process.version, nodeExecutable: process.execPath, nodeSha256: hashFile(process.execPath),
      platform: process.platform, arch: process.arch,
      tsx: JSON.parse(readFileSync(join(repository, "node_modules/tsx/package.json"), "utf8")).version,
      git: String(git(["--version"])).trim(), tar: String(command("/usr/bin/tar", ["--version"])).trim(),
      os: String(command("/usr/bin/sw_vers", [])).trim() };
    toolBefore = namespace(join(repository, "node_modules"));
    report.toolNamespaceBefore = toolBefore.sha256;
    const tracked = git(["ls-tree", "-r", "-z", candidate, "--", ...selectedPaths]).toString().split("\0").filter(Boolean).map(line => {
      const [metadata, path] = line.split("\t");
      const [mode, type, object] = metadata.split(" ");
      return { path, mode, type, object };
    });
    artifacts["git-inputs.json"] = json(tracked);
    archive = join(temporary, "candidate.tar");
    writeFileSync(archive, git(["archive", "--format=tar", candidate, "--", ...selectedPaths]));
    report.archiveBefore = hashFile(archive);
    const initial = join(temporary, "initial-location");
    mkdirSync(join(initial, "tree"), { recursive: true });
    mkdirSync(join(initial, "native-bin"));
    command("/usr/bin/tar", ["-xf", archive, "-C", join(initial, "tree")]);
    const committed = namespace(join(initial, "tree"));
    assert.deepEqual(committed.entries.filter(entry => entry.type !== "directory").map(entry => entry.path).sort(), tracked.map(entry => entry.path).sort());
    for (const entry of tracked) {
      assert.equal(entry.type, "blob");
      const file = join(initial, "tree", entry.path);
      const content = readFileSync(file);
      const object = createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
      assert.equal(object, entry.object, `committed blob authentication: ${entry.path}`);
      assert.equal(lstatSync(file).mode & 0o111, entry.mode === "100755" ? 0o111 : 0);
    }
    artifacts["committed-source-manifest.json"] = json(committed);
    report.committedFileCount = tracked.length;
    copyFileSync(originalExecutable, join(initial, "native-bin/strings"));
    chmodSync(join(initial, "native-bin/strings"), 0o700);
    symlinkSync(join(repository, "node_modules"), join(initial, "tree/node_modules"));
    const preMove = namespace(initial);
    moved = join(temporary, "moved committed workspace");
    renameSync(initial, moved);
    assert.equal(existsSync(initial), false);
    assert.deepEqual(namespace(moved), preMove);
    const tree = join(moved, "tree");
    const executable = join(moved, "native-bin/strings");
    assert.equal(fingerprint(executable).sha256, nativeHash);
    assert.notEqual(realpathSync(executable), nativeBefore.resolved);
    report.movement = { initial, moved, originalLocationAbsent: !existsSync(initial), namespaceUnchangedByMove: true };
    report.stagedNativeBefore = fingerprint(executable);
    before = namespace(moved);
    artifacts["namespace-before.json"] = json(before);
    const goldenBytes = readFileSync(join(tree, goldenPath));
    assert.equal(sha256(goldenBytes), goldenHash);
    assert.deepEqual(goldenBytes, git(["show", `${candidate}^:${goldenPath}`]));
    assert.deepEqual(goldenBytes, git(["show", `4af1b107d4b9449a2c4e7fed467d187448392fd5:${goldenPath}`]));
    const observations = JSON.parse(goldenBytes).observations;
    assert.equal(observations.length, 13);
    const stderr = Buffer.from(observations.find(item => item.id === "gnu-lone-dash-stdin").stderrHex, "hex");
    assert.equal(stderr.length, 1564);
    assert.equal(sha256(stderr), stderrHash);
    report.goldenBefore = { sha256: sha256(goldenBytes), observations: observations.length, stderrBytes: stderr.length, stderrSha256: sha256(stderr),
      equalsCandidateParent: true, equalsOriginalGoldenCommit: "4af1b107d4b9449a2c4e7fed467d187448392fd5" };
    const probe = join(temporary, "namespace-probe");
    mkdirSync(probe);
    const emptyProbe = namespace(probe);
    patchFiles({ [join(probe, "appended.data")]: "namespace append probe\n" }, repository);
    const appendedProbe = namespace(probe);
    assert.notDeepEqual(appendedProbe, emptyProbe);
    assert.notEqual(appendedProbe.sha256, emptyProbe.sha256);
    rmSync(probe, { recursive: true });
    report.appendDetectionControl = { pass: true, before: emptyProbe, after: appendedProbe, removed: !existsSync(probe) };
    const auditDirectory = join(temporary, "audit");
    mkdirSync(auditDirectory);
    const environment = {
      TSX_DISABLE_CACHE: "1", STREAM_NATIVE_LIVE: "1", STREAM_GNU_STRINGS: executable,
      ARGV0_REVIEW_MODE: "audit", ARGV0_REVIEW_TREE: tree, ARGV0_REVIEW_WORK: temporary,
      ARGV0_REVIEW_AUDIT_DIRECTORY: auditDirectory,
    };
    const cohortArgs = ["--import", "tsx", "--import", modulePath, "--test", "--test-reporter=tap", `${streamDirectory}/gnu-strings.test.ts`];
    const tap = String(command(process.execPath, cohortArgs, { cwd: tree, env: { ...process.env, ...environment }, recordEnv: environment, detached: true }));
    artifacts["original-cohort.tap"] = tap;
    for (const [label, count] of Object.entries({ tests: 14, pass: 14, fail: 0, skipped: 0, cancelled: 0, todo: 0 })) {
      assert.match(tap, new RegExp(`^# ${label} ${count}$`, "mu"));
    }
    assert.match(tap, /ok 14 - live pinned GNU2.44 strings observations/u);
    report.originalCohort = { tests: 14, pass: 14, fail: 0, skip: 0, nativeObservations: 13, originalTestUnmodified: true, authorTestsNotRun: true };
    const readAudit = () => readdirSync(auditDirectory).sort().flatMap(name => readFileSync(join(auditDirectory, name), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)));
    const cohortAudit = readAudit();
    const nativeCalls = cohortAudit.filter(entry => entry.kind === "spawnSync");
    assert.equal(nativeCalls.length, 14);
    assert.equal(nativeCalls[0].argv0Present, false);
    assert.deepEqual(nativeCalls[0].args, ["--version"]);
    assert.equal(nativeCalls.filter(entry => entry.argv0 === originalExecutable).length, 13);
    assert.equal(nativeCalls.find(entry => entry.stderrBytes === 1564)?.stderrSha256, stderrHash);
    artifacts["original-cohort-native-audit.json"] = json(cohortAudit);
    assert.deepEqual(namespace(moved), before);
    const controlsEnv = { ...environment, ARGV0_REVIEW_MODE: "controls" };
    const controlText = String(command(process.execPath, ["--import", "tsx", modulePath], { cwd: tree,
      env: { ...process.env, ...controlsEnv }, recordEnv: controlsEnv, detached: true }));
    const controlResult = JSON.parse(controlText);
    assert.equal(controlResult.pass, 10);
    assert.equal(controlResult.fail, 0);
    assert.equal(controlResult.skip, 0);
    artifacts["controls.json"] = json(controlResult);
    report.controls = { pass: controlResult.pass, fail: 0, skip: 0, appendDetectionAdditional: 1 };
    const allAudit = readAudit();
    artifacts["all-native-audit.json"] = json(allAudit);
    const allNative = allAudit.filter(entry => entry.kind === "spawnSync");
    assert.equal(allNative.length, 38);
    assert.ok(allNative.every(entry => entry.selected === executable && entry.before.sha256 === nativeHash && entry.after.sha256 === nativeHash));
    assert.equal(allAudit.filter(entry => entry.kind === "audit-start").length, allAudit.filter(entry => entry.kind === "audit-exit" && entry.code === 0).length);
    const auditedPids = [...new Set(allAudit.flatMap(entry => entry.kind === "spawnSync" ? [entry.childPid, entry.parentPid] : [entry.pid]))].filter(Boolean);
    await new Promise(done => setTimeout(done, 50));
    report.childCleanup = { nativeInvocations: allNative.length, auditedPids, remainingPids: auditedPids.filter(alive), remainingGroups: groups.filter(group => alive(-group)) };
    assert.deepEqual(report.childCleanup.remainingPids, []);
    assert.deepEqual(report.childCleanup.remainingGroups, []);
    report.stagedNativeAfter = fingerprint(executable);
    assert.deepEqual(report.stagedNativeAfter, report.stagedNativeBefore);
    report.goldenAfter = { sha256: hashFile(join(tree, goldenPath)),
      stderrSha256: sha256(Buffer.from(JSON.parse(readFileSync(join(tree, goldenPath), "utf8")).observations.find(item => item.id === "gnu-lone-dash-stdin").stderrHex, "hex")) };
    assert.equal(report.goldenAfter.sha256, report.goldenBefore.sha256);
    assert.equal(report.goldenAfter.stderrSha256, stderrHash);
    report.passed = true;
  } catch (error) {
    report.failure = { message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    try {
      if (moved && before) {
        const after = namespace(moved);
        artifacts["namespace-after.json"] = json(after);
        report.namespace = { before: before.sha256, after: after.sha256, equal: json(after) === json(before), includesNewEntries: true };
        assert.deepEqual(after, before);
      }
      if (archive) {
        report.archiveAfter = hashFile(archive);
        assert.equal(report.archiveAfter, report.archiveBefore);
      }
      report.originalNativeAfter = fingerprint(originalExecutable);
      if (nativeBefore) assert.deepEqual(report.originalNativeAfter, nativeBefore);
      if (toolBefore) {
        const toolAfter = namespace(join(repository, "node_modules"));
        report.toolNamespaceAfter = toolAfter.sha256;
        assert.deepEqual(toolAfter, toolBefore);
      }
      report.liveAfter = { head: String(git(["rev-parse", "HEAD"])).trim(),
        status: String(git(["status", "--short", "--untracked-files=all"])), index: String(git(["diff", "--cached", "--name-status"])) };
      report.candidateCommitSha256After = sha256(git(["cat-file", "commit", candidate]));
      assert.equal(report.candidateCommitSha256After, report.candidateCommitSha256);
      assert.equal(sha256(git(["archive", "--format=tar", candidate, "--", ...selectedPaths])), report.archiveBefore);
    } catch (error) {
      report.passed = false;
      report.integrityFailure = { message: error.message, stack: error.stack };
      process.exitCode = 1;
    }
    for (const group of groups) {
      if (alive(-group)) {
        process.kill(-group, "SIGKILL");
        report.passed = false;
        report.forcedGroupCleanup = [...(report.forcedGroupCleanup ?? []), group];
        process.exitCode = 1;
      }
    }
    rmSync(temporary, { recursive: true, force: true });
    report.temporaryRemoved = !existsSync(temporary);
    report.finished = new Date().toISOString();
    report.elapsedSeconds = (Date.now() - started.getTime()) / 1000;
    report.driverSha256 = hashFile(modulePath);
    report.limitations = [
      "Bounded candidate-specific GNU strings verification only; Frozen8670 remains unqualified.",
      "No fullgate, superiority, broad shell parity, service acceptance, or 72-hour-work claim.",
      "Darwin arm64 GNU Binutils 2.44 with the already provisioned system-zlib build; not GNU/Linux.",
      "Original configured path is read and hashed, never executed by this verifier; staged copy is the only audited native executable.",
      "Native-call audit forwards the original Node spawnSync without mocking results; it is not a kernel-level execution trace.",
      "Source authentication covers the selected committed archive, not every repository file or TypeScript consumer.",
      "Namespace scans include all current entries, modes, symlink targets and regular-file hashes without following node_modules symlinks; shared node_modules is separately hashed.",
      "Before/after equality and PID liveness are point-in-time checks, not proof against transient mutation/restoration or PID reuse.",
      "Candidate source/helpers/goldens remain unchanged. Controls supplement and do not replace the original 13-observation corpus and live native test.",
      "No oracle publisher entrypoint, golden recapture, normalization, dependency installation, staging, or commit is performed.",
    ];
    artifacts["commands.json"] = json(commands);
    artifacts["report.json"] = json(report);
    patchFiles(Object.fromEntries(Object.entries(artifacts).map(([name, content]) => [join(output, name), content])), repository);
    process.stdout.write(json({ passed: report.passed, output, failure: report.failure ?? report.integrityFailure ?? null, temporaryRemoved: report.temporaryRemoved }));
  }
}

if (process.env.ARGV0_REVIEW_MODE === "audit") installNativeAudit();
else if (process.env.ARGV0_REVIEW_MODE === "controls") await controls();
else await driver();
