import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access, chmod, cp, copyFile, lstat, mkdir, open, readFile, readdir, readlink,
  realpath, rm, stat, writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mutations } from "./mutations.mjs";

const candidate = "f1a90436c45208ca248e058a039893233c608daa";
const evidenceCommit = "0d8623634995549d8e717d310c28db83a02a9532";
const freezeCommits = [
  "a0445f4d5cff1c8451957ce684273e1225279588",
  "55bd112804564605e397d3ee9948226d89efd457",
];
const harnessRoot = dirname(fileURLToPath(import.meta.url));
const controlRoot = resolve(harnessRoot, "..");
const repositoryRoot = resolve(harnessRoot, "../../../../..");
const outputLimit = 32 * 1024 * 1024;
const commands = [];

const sha256 = value => createHash("sha256").update(value).digest("hex");
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const errorRecord = error => ({
  name: error?.name ?? typeof error,
  message: error?.message ?? String(error),
  code: error?.code ?? null,
  stack: typeof error?.stack === "string" ? error.stack.split("\n").slice(0, 12) : [],
});

function safeLabel(label) {
  assert.match(label, /^[a-z0-9][a-z0-9-]*$/u);
  return label;
}

async function executable(name) {
  assert.match(name, /^[A-Za-z0-9_.+-]+$/u);
  for (const folder of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const path = resolve(folder, name);
    try { await access(path, fsConstants.X_OK); return path; }
    catch { /* continue */ }
  }
  throw new Error(`Executable not found: ${name}`);
}

async function absentPid(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) {
    if (error?.code === "ESRCH") return true;
    throw error;
  }
}

async function absentProcessGroup(pid) {
  if (process.platform === "win32") return null;
  try { process.kill(-pid, 0); return false; }
  catch (error) {
    if (error?.code === "ESRCH") return true;
    throw error;
  }
}

async function runCommand(attemptRoot, label, command, args, options = {}) {
  safeLabel(label);
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const stdout = [], stderr = [];
  let stdoutBytes = 0, stderrBytes = 0, overflow = false, timedOut = false;
  let outputHandle;
  const stdio = ["ignore", "pipe", "pipe"];
  if (options.stdoutPath) {
    outputHandle = await open(options.stdoutPath, "wx");
    stdio[1] = outputHandle.fd;
  }
  const child = spawn(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    detached: process.platform !== "win32",
    stdio,
  });
  const pid = child.pid;
  const killScope = () => {
    if (process.platform !== "win32") {
      try { process.kill(-pid, "SIGKILL"); return; }
      catch (error) { if (error?.code !== "ESRCH") throw error; }
    }
    child.kill("SIGKILL");
  };
  let exitEvent = null;
  child.once("exit", (code, signal) => { exitEvent = { code, signal }; });
  const capture = (list, which) => chunk => {
    const copied = Buffer.from(chunk);
    if (which === "stdout") stdoutBytes += copied.byteLength;
    else stderrBytes += copied.byteLength;
    const total = stdoutBytes + stderrBytes;
    if (total <= (options.outputLimit ?? outputLimit)) list.push(copied);
    else if (!overflow) { overflow = true; killScope(); }
  };
  if (!options.stdoutPath) child.stdout.on("data", capture(stdout, "stdout"));
  child.stderr.on("data", capture(stderr, "stderr"));
  const timeoutMs = options.timeoutMs ?? 120000;
  const timer = setTimeout(() => { timedOut = true; killScope(); }, timeoutMs);
  const closeEvent = await new Promise(accept => child.once("close", (code, signal) => accept({ code, signal })));
  clearTimeout(timer);
  await outputHandle?.close();
  const stdoutBuffer = options.stdoutPath ? Buffer.alloc(0) : Buffer.concat(stdout);
  const stderrBuffer = Buffer.concat(stderr);
  const record = {
    label, command, args, cwd: options.cwd ?? repositoryRoot, pid, startedAt,
    durationMs: Math.round((performance.now() - start) * 1000) / 1000,
    timeoutMs, timedOut, overflow, exitEvent, closeEvent,
    absentAfterClose: await absentPid(pid),
    processGroupAbsentAfterClose: await absentProcessGroup(pid),
    stdoutBytes, stderrBytes,
    stdoutSha256: options.stdoutPath ? sha256(await readFile(options.stdoutPath)) : sha256(stdoutBuffer),
    stderrSha256: sha256(stderrBuffer),
  };
  commands.push(record);
  if (options.retainRaw !== false) {
    if (!options.stdoutPath) await writeFile(join(attemptRoot, "raw", `${label}.stdout`), stdoutBuffer);
    await writeFile(join(attemptRoot, "raw", `${label}.stderr`), stderrBuffer);
  }
  return { record, stdout: stdoutBuffer, stderr: stderrBuffer };
}

function assertCommandExit(result, expectedCode) {
  assert.deepEqual(result.record.closeEvent, { code: expectedCode, signal: null },
    `${result.record.label} failed: ${result.stderr.toString("utf8")}`);
  assert.equal(result.record.timedOut, false);
  assert.equal(result.record.overflow, false);
  assert.equal(result.record.absentAfterClose, true);
  assert.notEqual(result.record.processGroupAbsentAfterClose, false);
}

function assertCommand(result) { assertCommandExit(result, 0); }

async function fileRecord(requestedPath) {
  const resolvedPath = await realpath(requestedPath);
  const bytes = await readFile(resolvedPath);
  return { requestedPath, resolvedPath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function versionRecord(attemptRoot, name, path, args) {
  const result = await runCommand(attemptRoot, `version-${name}`, path, args, { timeoutMs: 10000 });
  assertCommand(result);
  return { ...(await fileRecord(path)), version: result.stdout.toString("utf8").trim() || result.stderr.toString("utf8").trim() };
}

function parseTree(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean).map(row => {
    const match = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]+)$/u.exec(row);
    assert.ok(match, `Invalid ls-tree row: ${row}`);
    return { mode: match[1], type: match[2], oid: match[3], path: match[4] };
  });
}

function gitBlobOid(bytes, expectedOid) {
  const algorithm = expectedOid.length === 40 ? "sha1" : "sha256";
  return createHash(algorithm).update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

async function trackedInventory(sourceRoot, treeRows) {
  const files = [];
  for (const row of treeRows) {
    assert.equal(row.type, "blob", `unsupported Git entry ${row.type}: ${row.path}`);
    const path = join(sourceRoot, ...row.path.split("/"));
    const info = await lstat(path);
    const bytes = info.isSymbolicLink() ? Buffer.from(await readlink(path)) : await readFile(path);
    const oid = gitBlobOid(bytes, row.oid);
    assert.equal(oid, row.oid, `archive blob mismatch: ${row.path}`);
    files.push({ path: row.path, mode: row.mode, oid, size: bytes.byteLength, sha256: sha256(bytes) });
  }
  return files;
}

async function walkFiles(root) {
  const paths = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      const name = relative(root, path).split(sep).join("/");
      if (entry.isDirectory()) await walk(path);
      else paths.push(name);
    }
  }
  await walk(root);
  paths.sort();
  return paths;
}

async function installedInventory(root) {
  const paths = await walkFiles(root);
  const hash = createHash("sha256");
  let bytes = 0;
  for (const path of paths) {
    const value = await readFile(join(root, ...path.split("/")));
    bytes += value.byteLength;
    hash.update(`${path}\0${value.byteLength}\0`).update(value);
  }
  return { count: paths.length, bytes, inventorySha256: hash.digest("hex"), paths };
}

async function authenticateCommit(attemptRoot, git, label, oid) {
  const commitResult = await runCommand(attemptRoot, `resolve-${label}-commit`, git,
    ["rev-parse", "--verify", `${oid}^{commit}`], { retainRaw: false });
  assertCommand(commitResult);
  const resolvedCommit = commitResult.stdout.toString("utf8").trim();
  assert.equal(resolvedCommit, oid);
  const treeResult = await runCommand(attemptRoot, `resolve-${label}-tree`, git,
    ["rev-parse", "--verify", `${oid}^{tree}`], { retainRaw: false });
  assertCommand(treeResult);
  return { requestedCommit: oid, resolvedCommit, tree: treeResult.stdout.toString("utf8").trim() };
}

async function gitShow(attemptRoot, git, oid, path) {
  const result = await runCommand(attemptRoot, `show-${sha256(`${oid}:${path}`).slice(0, 16)}`, git,
    ["show", `${oid}:${path}`], { retainRaw: false });
  assertCommand(result);
  return result.stdout;
}

async function prerequisiteAuthentication(attemptRoot, git) {
  const candidateRecord = await authenticateCommit(attemptRoot, git, "candidate", candidate);
  const evidence = await authenticateCommit(attemptRoot, git, "evidence", evidenceCommit);
  const freezes = [];
  for (let index = 0; index < freezeCommits.length; index++) {
    freezes.push(await authenticateCommit(attemptRoot, git, `freeze-${index + 1}`, freezeCommits[index]));
  }
  const reportRoot = "benchmarks/reports/tree-charset-20260827";
  const sealBytes = await gitShow(attemptRoot, git, evidenceCommit, `${reportRoot}/SEAL.json`);
  const seal = JSON.parse(sealBytes.toString("utf8"));
  const sealedFiles = [];
  for (const [name, expected] of Object.entries(seal)) {
    const bytes = await gitShow(attemptRoot, git, evidenceCommit, `${reportRoot}/${name}`);
    const actual = sha256(bytes);
    assert.equal(actual, expected, `evidence seal mismatch: ${name}`);
    sealedFiles.push({ name, bytes: bytes.byteLength, sha256: actual });
  }
  const readme = await gitShow(attemptRoot, git, evidenceCommit, `${reportRoot}/README.md`);
  const readmeLines = readme.toString("utf8").split("\n");
  assert.equal(readmeLines[133], "## Independent review request");
  const freezeTrees = [];
  for (const [index, path] of [
    "tests/commands/tree-charset-independent-20260827/freeze",
    "tests/commands/tree-charset-independent-20260827/native-independent",
  ].entries()) {
    const result = await runCommand(attemptRoot, `resolve-freeze-subtree-${index + 1}`, git,
      ["rev-parse", `${freezeCommits[index]}:${path}`], { retainRaw: false });
    assertCommand(result);
    freezeTrees.push({ commit: freezeCommits[index], path, tree: result.stdout.toString("utf8").trim() });
  }
  return {
    candidate: candidateRecord,
    evidence: { ...evidence, sealSha256: sha256(sealBytes), sealedFiles },
    freezes,
    freezeTrees,
    handoff: { path: `${reportRoot}/README.md`, line: 134, excerpt: readmeLines.slice(133, 144) },
  };
}

async function applyMutation(packageRoot, mutation) {
  const path = join(packageRoot, ...mutation.file.split("/"));
  const original = await readFile(path, "utf8");
  const occurrences = original.split(mutation.search).length - 1;
  assert.equal(occurrences, 1, `${mutation.id}: expected one exact mutation site, got ${occurrences}`);
  const changed = original.replace(mutation.search, mutation.replacement);
  assert.notEqual(changed, original);
  await writeFile(path, changed);
  const reread = await readFile(path, "utf8");
  assert.equal(reread, changed);
  return {
    ...mutation,
    occurrences,
    beforeSha256: sha256(original),
    afterSha256: sha256(changed),
    beforeBytes: Buffer.byteLength(original),
    afterBytes: Buffer.byteLength(changed),
  };
}

async function runWorker(attemptRoot, variantRoot, variant) {
  const worker = join(variantRoot, "worker.mjs");
  await copyFile(join(harnessRoot, "worker.mjs"), worker);
  const result = await runCommand(attemptRoot, `worker-${variant}`, process.execPath,
    ["--unhandled-rejections=strict", worker], {
      cwd: variantRoot,
      env: {
        PATH: process.env.PATH ?? dirname(process.execPath),
        LANG: "C", LC_ALL: "C", TZ: "UTC", MUTATION_VARIANT: variant,
      },
      timeoutMs: 15000,
      outputLimit: 2 * 1024 * 1024,
    });
  assertCommand(result);
  const parsed = JSON.parse(result.stdout.toString("utf8"));
  assert.equal(parsed.pid, result.record.pid);
  return { process: result.record, result: parsed };
}

async function runLoadGuard(attemptRoot, consumerRoot, label, requested, expected, expectedCode) {
  const guard = join(consumerRoot, `load-guard-${label}.mjs`);
  await copyFile(join(harnessRoot, "load-guard.mjs"), guard);
  const result = await runCommand(attemptRoot, `load-guard-${label}`, process.execPath,
    ["--unhandled-rejections=strict", guard], {
      cwd: consumerRoot,
      env: {
        PATH: process.env.PATH ?? dirname(process.execPath),
        LANG: "C", LC_ALL: "C", TZ: "UTC",
        REQUESTED_LOAD: requested,
        EXPECTED_PACKAGE_ROOT: expected.packageRoot,
        EXPECTED_MANIFEST_SHA256: expected.manifestSha256,
        EXPECTED_ENTRY_SHA256: expected.entrySha256,
      },
      timeoutMs: 15000,
      outputLimit: 1024 * 1024,
    });
  assertCommandExit(result, expectedCode);
  const parsed = JSON.parse(result.stdout.toString("utf8"));
  assert.equal(parsed.pid, result.record.pid);
  return { process: result.record, result: parsed };
}

async function main(attemptRoot, workRoot) {
  assert.equal(resolve(repositoryRoot), process.cwd(), "run from repository root");
  const git = await executable("git");
  const npm = await executable("npm");
  const tar = await executable("tar");
  const tools = {
    node: { ...(await fileRecord(process.execPath)), version: process.version },
    git: await versionRecord(attemptRoot, "git", git, ["--version"]),
    npm: await versionRecord(attemptRoot, "npm", npm, ["--version"]),
    tar: await versionRecord(attemptRoot, "tar", tar, ["--version"]),
  };
  const harnessPaths = ["run.mjs", "mutations.mjs", "worker.mjs", "load-guard.mjs"].map(name => join(harnessRoot, name));
  const fixturePath = join(controlRoot, "fixtures/consumer-package.json");
  const toolManifest = [];
  for (const path of [...harnessPaths, fixturePath]) toolManifest.push(await fileRecord(path));

  const prerequisites = await prerequisiteAuthentication(attemptRoot, git);
  const archive = join(workRoot, "candidate.tar");
  const archiveRun = await runCommand(attemptRoot, "git-archive-candidate", git,
    ["archive", "--format=tar", candidate], { stdoutPath: archive, timeoutMs: 30000 });
  assertCommand(archiveRun);
  const archiveBefore = await fileRecord(archive);
  const sourceRoot = join(workRoot, "source");
  await mkdir(sourceRoot);
  const extract = await runCommand(attemptRoot, "extract-candidate", tar,
    ["-xf", archive, "-C", sourceRoot], { timeoutMs: 30000 });
  assertCommand(extract);

  const treeRun = await runCommand(attemptRoot, "candidate-ls-tree", git,
    ["ls-tree", "-rz", "-r", candidate], { retainRaw: false, timeoutMs: 30000 });
  assertCommand(treeRun);
  const treeRows = parseTree(treeRun.stdout);
  const sourceBefore = await trackedInventory(sourceRoot, treeRows);
  const sourceManifestPath = join(sourceRoot, "package.json");
  const sourceLockPath = join(sourceRoot, "package-lock.json");
  const sourceManifest = JSON.parse((await readFile(sourceManifestPath)).toString("utf8"));
  assert.equal(sourceManifest.name, "virtual-bash");
  assert.equal(sourceManifest.version, "0.0.0");
  assert.equal(sourceManifest.private, true);
  assert.deepEqual(sourceManifest.files, ["dist"]);
  assert.equal(Object.keys(sourceManifest.dependencies ?? {}).length, 0);

  const npmEnv = {
    ...process.env,
    LANG: "C", LC_ALL: "C", TZ: "UTC", CI: "1",
    npm_config_cache: join(workRoot, "npm-cache"),
    npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false",
  };
  const npmCi = await runCommand(attemptRoot, "npm-ci-candidate", npm,
    ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: sourceRoot, env: npmEnv, timeoutMs: 60000,
    });
  assertCommand(npmCi);
  tools.tsc = await fileRecord(join(sourceRoot, "node_modules/typescript/bin/tsc"));
  tools.tsx = await fileRecord(join(sourceRoot, "node_modules/tsx/dist/cli.mjs"));
  const build = await runCommand(attemptRoot, "npm-build-candidate", npm, ["run", "build"], {
    cwd: sourceRoot, env: npmEnv, timeoutMs: 60000,
  });
  assertCommand(build);

  const packRoot = join(workRoot, "pack");
  await mkdir(packRoot);
  const pack = await runCommand(attemptRoot, "npm-pack-candidate", npm,
    ["pack", "--json", "--pack-destination", packRoot], {
      cwd: sourceRoot, env: npmEnv, timeoutMs: 60000,
    });
  assertCommand(pack);
  const packJson = JSON.parse(pack.stdout.toString("utf8"));
  assert.equal(packJson.length, 1);
  assert.equal(packJson[0].name, "virtual-bash");
  assert.equal(packJson[0].version, "0.0.0");
  const tarballPath = join(packRoot, basename(packJson[0].filename));
  const tarballBytes = await readFile(tarballPath);
  const integrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`;
  assert.equal(integrity, packJson[0].integrity);
  const tarList = await runCommand(attemptRoot, "list-packed-tarball", tar, ["-tf", tarballPath], {
    timeoutMs: 30000,
  });
  assertCommand(tarList);
  const packedPaths = tarList.stdout.toString("utf8").split("\n").filter(Boolean);
  assert.ok(packedPaths.every(path => path === "package" || path.startsWith("package/")));
  assert.ok(packedPaths.some(path => path === "package/dist/index.js"));
  assert.ok(!packedPaths.some(path => path.startsWith("package/src/")));

  const consumerRoot = join(workRoot, "baseline-consumer");
  await mkdir(consumerRoot);
  await copyFile(fixturePath, join(consumerRoot, "package.json"));
  const install = await runCommand(attemptRoot, "npm-install-packed-candidate", npm,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarballPath], {
      cwd: consumerRoot, env: npmEnv, timeoutMs: 60000,
    });
  assertCommand(install);
  const installedRoot = join(consumerRoot, "node_modules/virtual-bash");
  const installedBefore = await installedInventory(installedRoot);
  const expectedLoad = {
    packageRoot: installedRoot,
    manifestSha256: (await fileRecord(join(installedRoot, "package.json"))).sha256,
    entrySha256: (await fileRecord(join(installedRoot, "dist/index.js"))).sha256,
  };
  const positiveLoad = await runLoadGuard(attemptRoot, consumerRoot, "positive-installed",
    "virtual-bash", expectedLoad, 0);
  assert.equal(positiveLoad.result.allowed, true);
  assert.equal(positiveLoad.result.loaded, true);

  const wrongSource = join(workRoot, "wrong-package-source");
  await mkdir(join(wrongSource, "dist"), { recursive: true });
  await writeFile(join(wrongSource, "package.json"), json({
    name: "virtual-bash", version: "9.9.9", private: true, type: "module",
    files: ["dist"], exports: { ".": "./dist/index.js" },
  }));
  await writeFile(join(wrongSource, "dist/index.js"), 'export const marker = "wrong-installed-package";\n');
  const wrongPackRoot = join(workRoot, "wrong-pack");
  await mkdir(wrongPackRoot);
  const wrongPack = await runCommand(attemptRoot, "npm-pack-wrong-package", npm,
    ["pack", "--json", "--pack-destination", wrongPackRoot], {
      cwd: wrongSource, env: npmEnv, timeoutMs: 60000,
    });
  assertCommand(wrongPack);
  const wrongPackJson = JSON.parse(wrongPack.stdout.toString("utf8"));
  assert.equal(wrongPackJson[0]?.name, "virtual-bash");
  assert.equal(wrongPackJson[0]?.version, "9.9.9");
  const wrongConsumer = join(workRoot, "wrong-consumer");
  await mkdir(wrongConsumer);
  await copyFile(fixturePath, join(wrongConsumer, "package.json"));
  const wrongTarball = join(wrongPackRoot, basename(wrongPackJson[0].filename));
  const wrongInstall = await runCommand(attemptRoot, "npm-install-wrong-package", npm,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", wrongTarball], {
      cwd: wrongConsumer, env: npmEnv, timeoutMs: 60000,
    });
  assertCommand(wrongInstall);
  const wrongInstalledRoot = join(wrongConsumer, "node_modules/virtual-bash");
  const wrongLoad = await runLoadGuard(attemptRoot, wrongConsumer, "wrong-installed-package",
    "virtual-bash", { ...expectedLoad, packageRoot: wrongInstalledRoot }, 77);
  assert.equal(wrongLoad.result.allowed, false);
  assert.equal(wrongLoad.result.loaded, false);
  assert.ok(wrongLoad.result.rejectionReasons.includes("package manifest hash mismatch"));
  assert.ok(wrongLoad.result.rejectionReasons.includes("package entry hash mismatch"));

  const outsideRoot = join(workRoot, "outside-source-copy/virtual-bash");
  await mkdir(dirname(outsideRoot), { recursive: true });
  await cp(installedRoot, outsideRoot, { recursive: true, verbatimSymlinks: true });
  const outsideRequested = pathToFileURL(join(outsideRoot, "dist/index.js")).href;
  const outsideLoad = await runLoadGuard(attemptRoot, consumerRoot, "outside-same-bytes",
    outsideRequested, expectedLoad, 77);
  assert.equal(outsideLoad.result.allowed, false);
  assert.equal(outsideLoad.result.loaded, false);
  assert.deepEqual(outsideLoad.result.rejectionReasons, ["resolved package root is outside expected installation"]);
  assert.equal(outsideLoad.result.actual.manifestSha256, expectedLoad.manifestSha256);
  assert.equal(outsideLoad.result.actual.entrySha256, expectedLoad.entrySha256);

  const baseline = await runWorker(attemptRoot, consumerRoot, "baseline");
  assert.equal(baseline.result.pass, true, json(baseline.result));
  assert.equal(baseline.result.failed, 0);

  const mutantRuns = [];
  for (const mutation of mutations) {
    const variantRoot = join(workRoot, "variants", mutation.id);
    await mkdir(dirname(variantRoot), { recursive: true });
    await cp(consumerRoot, variantRoot, { recursive: true, verbatimSymlinks: true });
    const mutationRecord = await applyMutation(join(variantRoot, "node_modules/virtual-bash"), mutation);
    const run = await runWorker(attemptRoot, variantRoot, mutation.id);
    assert.deepEqual(run.result.assertionPlan, baseline.result.assertionPlan, `${mutation.id}: assertion plan changed`);
    assert.ok(run.result.failed >= 1, `${mutation.id}: mutant survived unchanged assertions`);
    const target = run.result.checks.find(check => check.id === mutation.targetCheck);
    assert.ok(target, `${mutation.id}: missing target check ${mutation.targetCheck}`);
    assert.equal(target.pass, false, `${mutation.id}: target check survived`);
    mutantRuns.push({ mutation: mutationRecord, ...run });
  }

  const installedAfter = await installedInventory(installedRoot);
  assert.deepEqual(installedAfter, installedBefore, "baseline installation changed during mutant execution");
  const sourceAfter = await trackedInventory(sourceRoot, treeRows);
  assert.deepEqual(sourceAfter, sourceBefore, "authenticated archived source paths changed during build/pack/run");
  const everySourcePath = await walkFiles(sourceRoot);
  const originalPaths = new Set(treeRows.map(row => row.path));
  const addedPaths = everySourcePath.filter(path => !originalPaths.has(path));
  const unexpectedAddedPaths = addedPaths.filter(path => !path.startsWith("dist/") && !path.startsWith("node_modules/"));
  assert.deepEqual(unexpectedAddedPaths, [], "unexpected entries added to archive extraction");
  const archiveAfter = await fileRecord(archive);
  assert.deepEqual(archiveAfter, archiveBefore, "candidate archive changed after execution");
  const allChildren = [baseline.process, ...mutantRuns.map(item => item.process)];
  assert.ok(allChildren.every(child => child.absentAfterClose && child.processGroupAbsentAfterClose !== false
    && !child.timedOut && !child.overflow));

  const targetKills = Object.fromEntries(mutantRuns.map(item => [
    item.mutation.id,
    item.result.checks.filter(check => !check.pass).map(check => check.id),
  ]));
  const output = {
    schema: 1,
    candidate,
    createdAt: new Date().toISOString(),
    prerequisites,
    tools,
    toolManifest,
    archive: { before: archiveBefore, after: archiveAfter, trackedFileCount: treeRows.length },
    source: {
      manifest: { ...await fileRecord(sourceManifestPath), name: sourceManifest.name, version: sourceManifest.version,
        private: sourceManifest.private, runtimeDependencyCount: Object.keys(sourceManifest.dependencies ?? {}).length },
      lock: await fileRecord(sourceLockPath),
      authenticatedTrackedFiles: sourceBefore.length,
      authenticatedInventorySha256: sha256(json(sourceBefore)),
      postflightTrackedFilesUnchanged: true,
      postflightDetectsNewEntries: true,
      addedBuildOrToolFileCount: addedPaths.length,
      unexpectedAddedPaths,
    },
    pack: {
      npm: packJson[0], tarball: { path: basename(tarballPath), bytes: tarballBytes.byteLength,
        sha256: sha256(tarballBytes), integrity }, packedPathCount: packedPaths.length,
      containsSourcePath: packedPaths.some(path => path.startsWith("package/src/")),
    },
    install: { before: installedBefore, unchangedAfterRuns: true },
    loadControls: { expected: expectedLoad, positive: positiveLoad, wrongInstalled: wrongLoad, outsideSameBytes: outsideLoad },
    assertionPlan: baseline.result.assertionPlan,
    baseline,
    mutants: mutantRuns,
    summary: {
      baselineAssertionsPassed: baseline.result.passed,
      baselineAssertionsFailed: baseline.result.failed,
      mutants: mutantRuns.length,
      mutantsKilled: mutantRuns.filter(item => item.result.failed > 0).length,
      targetChecksKilled: mutantRuns.filter(item => item.result.checks.find(check =>
        check.id === item.mutation.targetCheck)?.pass === false).length,
      targetKills,
      workerChildren: allChildren.length,
      workerChildrenClosed: allChildren.filter(child => child.absentAfterClose).length,
      workerProcessGroupsClosed: allChildren.filter(child => child.processGroupAbsentAfterClose !== false).length,
      workerTimeouts: allChildren.filter(child => child.timedOut).length,
      workerOutputOverflows: allChildren.filter(child => child.overflow).length,
      loadControlChildren: 3,
      loadControlExpectedResults: [positiveLoad, wrongLoad, outsideLoad].filter(item =>
        item.process.absentAfterClose && item.process.processGroupAbsentAfterClose !== false).length,
    },
    limitations: [
      "This is a bounded tree-charset mutation review, not a full repository gate or superiority proof.",
      "Exact text replacements authenticate these eight built-JavaScript mutants; they do not enumerate all equivalent faults.",
      "The outside-source negative control proves only that a nonexistent resolved file URL does not load; Node.js is not a sandbox and an existing explicitly imported file can execute.",
      "Post-close kill(pid, 0) absence is an observation after the close event and cannot exclude instantaneous PID reuse.",
      "The run authenticates every original archive path and rejects every new source-tree path outside dist/ and node_modules/; generated dependency/build trees are classified, not compared to Git.",
    ],
    pass: true,
  };
  await writeFile(join(attemptRoot, "results.json"), json(output));
  return output;
}

await mkdir(controlRoot, { recursive: true });
const attemptEntries = await readdir(controlRoot);
const attemptNumbers = attemptEntries.map(name => /^attempt-(\d{3})$/u.exec(name)?.[1]).filter(Boolean).map(Number);
const attemptName = `attempt-${String(Math.max(0, ...attemptNumbers) + 1).padStart(3, "0")}`;
const attemptRoot = join(controlRoot, attemptName);
const workRoot = join(controlRoot, ".work", attemptName);
await mkdir(join(attemptRoot, "raw"), { recursive: true });
await rm(workRoot, { recursive: true, force: true });
await mkdir(workRoot, { recursive: true });
let outcome;
try {
  const result = await main(attemptRoot, workRoot);
  outcome = { schema: 1, attempt: attemptName, pass: true, summary: result.summary };
} catch (error) {
  outcome = { schema: 1, attempt: attemptName, pass: false, error: errorRecord(error) };
} finally {
  await writeFile(join(attemptRoot, "commands.json"), json(commands));
  await writeFile(join(attemptRoot, "outcome.json"), json(outcome));
  await rm(workRoot, { recursive: true, force: true });
}
process.stdout.write(json(outcome));
if (!outcome.pass) process.exitCode = 1;
