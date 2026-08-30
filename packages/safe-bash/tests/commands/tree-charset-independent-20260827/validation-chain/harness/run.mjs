import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const CANDIDATE = "f1a90436c45208ca248e058a039893233c608daa";
const CANDIDATE_TREE = "c5cdfff66e64bb4d68926c4f93a7620eb89e7dcd";
const MAIN_EVIDENCE = "92d1dacd041d90f58fee81922815bbd606cceb8e";
const MAIN_EVIDENCE_TREE = "a9861f570f46d2f3d758c1ecc72ddd134ea31a57";
const TOOL_MANIFEST_PATH = "tests/commands/tree-charset-independent-20260827/execution/author-regression-001.json";
const SELECTED_INPUTS = ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"];
const DEFAULT_CAP = 1024 * 1024;
const DEFAULT_TIMEOUT = 120_000;
const harnessRoot = dirname(fileURLToPath(import.meta.url));
const validationRoot = resolve(harnessRoot, "..");
const repoRoot = resolve(validationRoot, "../../../..");
const commands = [];
let runtimeRoot;
let cleanup = { attempted: false, runtimeAbsent: false, liveChildrenAfterClose: [] };

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha512(bytes) {
  return createHash("sha512").update(bytes).digest("base64");
}

function sha1(bytes) {
  return createHash("sha1").update(bytes).digest("hex");
}

function gitBlobId(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function parseArguments(argv) {
  assert.equal(argv.length, 2, "usage: node harness/run.mjs --output validation-chain/attempt-NNN");
  assert.equal(argv[0], "--output");
  const output = resolve(repoRoot, argv[1]);
  assert.ok(output.startsWith(`${validationRoot}${sep}`), "output must be inside validation-chain");
  assert.match(basename(output), /^attempt-[0-9]{3}$/u, "output basename must be attempt-NNN");
  return output;
}

const outputRoot = parseArguments(process.argv.slice(2));
const rawRoot = join(outputRoot, "raw");

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function fileSha256(path) {
  return sha256(await readFile(path));
}

function sanitizeLabel(label) {
  return label.replaceAll(/[^a-z0-9._-]/giu, "_");
}

async function runCommand(label, executable, args, options = {}) {
  const safeLabel = sanitizeLabel(label);
  const stdoutCap = options.stdoutCap ?? DEFAULT_CAP;
  const stderrCap = options.stderrCap ?? DEFAULT_CAP;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const startedAt = new Date();
  const deadlineAt = new Date(startedAt.getTime() + timeoutMs);
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pid = child.pid;
  const stdoutChunks = [];
  const stderrChunks = [];
  let stdoutStoredBytes = 0;
  let stderrStoredBytes = 0;
  let stdoutTotalBytes = 0;
  let stderrTotalBytes = 0;
  let stdoutCapExceeded = false;
  let stderrCapExceeded = false;
  let timedOut = false;
  let killRequested = null;

  function collect(stream, bytes) {
    const isStdout = stream === "stdout";
    if (isStdout) stdoutTotalBytes += bytes.length;
    else stderrTotalBytes += bytes.length;
    const stored = isStdout ? stdoutStoredBytes : stderrStoredBytes;
    const cap = isStdout ? stdoutCap : stderrCap;
    const remaining = Math.max(0, cap - stored);
    if (remaining > 0) {
      const retained = Buffer.from(bytes.subarray(0, remaining));
      if (isStdout) {
        stdoutChunks.push(retained);
        stdoutStoredBytes += retained.length;
      } else {
        stderrChunks.push(retained);
        stderrStoredBytes += retained.length;
      }
    }
    if (bytes.length > remaining) {
      if (isStdout) stdoutCapExceeded = true;
      else stderrCapExceeded = true;
      if (killRequested === null) {
        killRequested = `${stream}-cap`;
        child.kill("SIGKILL");
      }
    }
  }

  child.stdout.on("data", bytes => collect("stdout", bytes));
  child.stderr.on("data", bytes => collect("stderr", bytes));
  const timer = setTimeout(() => {
    timedOut = true;
    if (killRequested === null) killRequested = "timeout";
    child.kill("SIGKILL");
  }, timeoutMs);

  const errorPromise = new Promise(resolveError => child.once("error", resolveError));
  const exitPromise = new Promise(resolveExit => child.once("exit", (code, signal) => resolveExit({ code, signal, at: new Date().toISOString() })));
  const closePromise = new Promise(resolveClose => child.once("close", (code, signal) => resolveClose({ code, signal, at: new Date().toISOString() })));
  const outcome = await Promise.race([
    Promise.all([exitPromise, closePromise]).then(([exit, close]) => ({ exit, close, spawnError: null })),
    errorPromise.then(error => ({ exit: null, close: null, spawnError: { name: error.name, message: error.message, code: error.code ?? null } })),
  ]);
  clearTimeout(timer);
  const endedAt = new Date();
  const stdout = Buffer.concat(stdoutChunks);
  const stderr = Buffer.concat(stderrChunks);
  await writeFile(join(rawRoot, `${safeLabel}.stdout`), stdout);
  await writeFile(join(rawRoot, `${safeLabel}.stderr`), stderr);
  let absentAfterClose = false;
  if (typeof pid === "number" && outcome.close !== null) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      absentAfterClose = error?.code === "ESRCH";
    }
  }
  const record = {
    label,
    executable,
    executableSha256: await fileSha256(executable),
    argv: [executable, ...args],
    cwd: options.cwd,
    env: options.env,
    pid: pid ?? null,
    startedAt: startedAt.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    timeoutMs,
    stdout: {
      capBytes: stdoutCap,
      totalBytes: stdoutTotalBytes,
      storedBytes: stdout.length,
      capExceeded: stdoutCapExceeded,
      truncated: stdoutCapExceeded,
      sha256OfStoredBytes: sha256(stdout),
      evidence: `raw/${safeLabel}.stdout`,
    },
    stderr: {
      capBytes: stderrCap,
      totalBytes: stderrTotalBytes,
      storedBytes: stderr.length,
      capExceeded: stderrCapExceeded,
      truncated: stderrCapExceeded,
      sha256OfStoredBytes: sha256(stderr),
      evidence: `raw/${safeLabel}.stderr`,
    },
    timedOut,
    killRequested,
    exit: outcome.exit,
    close: outcome.close,
    spawnError: outcome.spawnError,
    absentAfterClose,
  };
  commands.push(record);
  return { record, stdout, stderr };
}

function assertNormal(result, label = result.record.label) {
  assert.equal(result.record.spawnError, null, `${label}: spawn error`);
  assert.equal(result.record.exit?.code, 0, `${label}: ${result.stderr.toString()}`);
  assert.equal(result.record.exit?.signal, null, `${label}: unexpected signal`);
  assert.deepEqual(result.record.close, { ...result.record.exit, at: result.record.close.at }, `${label}: exit/close disagreement`);
  assert.equal(result.record.timedOut, false, `${label}: timeout`);
  assert.equal(result.record.stdout.capExceeded, false, `${label}: stdout cap`);
  assert.equal(result.record.stderr.capExceeded, false, `${label}: stderr cap`);
  assert.equal(result.record.absentAfterClose, true, `${label}: child remains`);
}

function minimalEnv(extra = {}) {
  return {
    PATH: dirname(process.execPath),
    HOME: join(runtimeRoot, "home"),
    TMPDIR: join(runtimeRoot, "tmp"),
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    npm_config_cache: join(runtimeRoot, "npm-cache"),
    npm_config_userconfig: join(runtimeRoot, "empty-user.npmrc"),
    npm_config_globalconfig: join(runtimeRoot, "empty-global.npmrc"),
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_ignore_scripts: "true",
    ...extra,
  };
}

async function walkFiles(root, options = {}) {
  const includeRealpath = options.includeRealpath ?? false;
  const result = {};
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const rel = relative(root, path).split(sep).join("/");
      const details = await lstat(path);
      assert.equal(details.isSymbolicLink(), false, `symlink not allowed: ${rel}`);
      if (details.isDirectory()) await visit(path);
      else {
        assert.equal(details.isFile(), true, `non-file not allowed: ${rel}`);
        const bytes = await readFile(path);
        const item = {
          sha256: sha256(bytes),
          bytes: bytes.length,
          mode: details.mode & 0o777,
        };
        if (includeRealpath) item.realpath = await realpath(path);
        result[rel] = item;
      }
    }
  }
  await visit(root);
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b, "en")));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseLsTree(text) {
  const result = {};
  for (const line of text.trimEnd().split("\n")) {
    if (!line) continue;
    const match = /^(\d+) blob ([0-9a-f]+)\t(.+)$/u.exec(line);
    assert.ok(match, `unexpected ls-tree line: ${line}`);
    result[match[3]] = { mode: Number.parseInt(match[1], 8) & 0o777, gitBlob: match[2] };
  }
  return result;
}

function parseTarGz(bytes) {
  const tar = gunzipSync(bytes);
  const files = {};
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const text = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/su, "");
    const name = text(0, 100);
    const prefix = text(345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(text(124, 12).trim() || "0", 8);
    const mode = Number.parseInt(text(100, 8).trim() || "0", 8) & 0o777;
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    assert.ok(dataStart + size <= tar.length, `truncated tar entry: ${fullName}`);
    if (type === "0" || type === "\0") {
      files[fullName] = { sha256: sha256(data), bytes: size, mode };
    } else {
      assert.equal(type, "5", `unsupported/non-regular tar entry ${type}: ${fullName}`);
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, "en")));
}

function contentProjection(manifest) {
  return Object.fromEntries(Object.entries(manifest).map(([path, value]) => [path, { sha256: value.sha256, bytes: value.bytes }]));
}

async function findNpmCli() {
  const candidate = resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
  assert.equal(await exists(candidate), true, `npm CLI not found at ${candidate}`);
  return candidate;
}

async function authenticateToolTree(toolManifest, sourceRoot) {
  const authentication = {};
  for (const [path, expected] of Object.entries(toolManifest).sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const source = join(sourceRoot, ...path.split("/"));
    const details = await lstat(source);
    assert.equal(details.isFile(), true, `tool must be regular file: ${path}`);
    assert.equal(details.isSymbolicLink(), false, `tool symlink refused: ${path}`);
    const bytes = await readFile(source);
    const actual = { sha256: sha256(bytes), bytes: bytes.length, mode: details.mode & 0o777 };
    assert.deepEqual(actual, expected, `tool mismatch: ${path}`);
    authentication[path] = actual;
  }
  return authentication;
}

async function copyAuthenticatedTools(authentication, sourceRoot, destination) {
  for (const [path, expected] of Object.entries(authentication)) {
    const source = join(sourceRoot, ...path.split("/"));
    const target = join(destination, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target, fsConstants.COPYFILE_EXCL);
    await chmod(target, expected.mode);
  }
  const copied = await walkFiles(destination);
  assert.deepEqual(copied, authentication, "copied tool manifest mismatch");
  return authentication;
}

async function writeTypeConsumer(root, packageSource, skipLibCheck) {
  await mkdir(root, { recursive: true });
  await copyFile(join(harnessRoot, "consumer-types.mts.data"), join(root, "consumer.mts"));
  const config = {
    compilerOptions: {
      strict: true,
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      skipLibCheck,
      noEmit: true,
      types: ["node"],
    },
    files: ["./consumer.mts"],
  };
  await writeJson(join(root, "tsconfig.json"), config);
  if (packageSource) {
    await mkdir(join(root, "node_modules"), { recursive: true });
    await cp(packageSource, join(root, "node_modules/virtual-bash"), { recursive: true, errorOnExist: true, force: false });
  }
  return config;
}

async function guardRun(label, probePath, mode, packageRoot, packageFiles, extraEnv = {}, mutateConfig) {
  const logPath = join(rawRoot, `${sanitizeLabel(label)}.loads.jsonl`);
  const config = {
    packageRoot,
    packageFiles: Object.fromEntries(Object.entries(packageFiles).map(([path, value]) => [path, value.sha256])),
    allowedHarness: [probePath],
    logPath,
  };
  if (mutateConfig) mutateConfig(config);
  const configPath = join(runtimeRoot, `${sanitizeLabel(label)}-guard.json`);
  await writeJson(configPath, config);
  const result = await runCommand(label, process.execPath, [
    "--no-warnings",
    "--unhandled-rejections=strict",
    "--experimental-loader",
    join(harnessRoot, "guard-loader.mjs"),
    probePath,
    mode,
  ], {
    cwd: dirname(probePath),
    env: minimalEnv({ VALIDATION_GUARD_CONFIG: configPath, ...extraEnv }),
    timeoutMs: 30_000,
  });
  return { ...result, logPath, config };
}

async function execute() {
  await mkdir(outputRoot, { recursive: false });
  await mkdir(rawRoot);
  runtimeRoot = await mkdtemp(join(tmpdir(), "safe-bash-validation-chain-"));
  await mkdir(join(runtimeRoot, "home"));
  await mkdir(join(runtimeRoot, "tmp"));
  await writeFile(join(runtimeRoot, "empty-user.npmrc"), "");
  await writeFile(join(runtimeRoot, "empty-global.npmrc"), "");
  const git = "/usr/bin/git";
  const tar = "/usr/bin/tar";
  assert.equal(await exists(git), true);
  assert.equal(await exists(tar), true);

  const candidateCommit = await runCommand("candidate-commit", git, ["rev-parse", `${CANDIDATE}^{commit}`], { cwd: repoRoot, env: minimalEnv() });
  assertNormal(candidateCommit);
  assert.equal(candidateCommit.stdout.toString(), `${CANDIDATE}\n`);
  const candidateTree = await runCommand("candidate-tree", git, ["rev-parse", `${CANDIDATE}^{tree}`], { cwd: repoRoot, env: minimalEnv() });
  assertNormal(candidateTree);
  assert.equal(candidateTree.stdout.toString(), `${CANDIDATE_TREE}\n`);
  const evidenceCommit = await runCommand("evidence-commit", git, ["rev-parse", `${MAIN_EVIDENCE}^{commit}`], { cwd: repoRoot, env: minimalEnv() });
  assertNormal(evidenceCommit);
  assert.equal(evidenceCommit.stdout.toString(), `${MAIN_EVIDENCE}\n`);
  const evidenceTree = await runCommand("evidence-tree", git, ["rev-parse", `${MAIN_EVIDENCE}^{tree}`], { cwd: repoRoot, env: minimalEnv() });
  assertNormal(evidenceTree);
  assert.equal(evidenceTree.stdout.toString(), `${MAIN_EVIDENCE_TREE}\n`);

  const toolBlobResult = await runCommand("tool-manifest-blob", git, ["rev-parse", `${MAIN_EVIDENCE}:${TOOL_MANIFEST_PATH}`], { cwd: repoRoot, env: minimalEnv() });
  assertNormal(toolBlobResult);
  const toolBlob = toolBlobResult.stdout.toString().trim();
  assert.match(toolBlob, /^[0-9a-f]{40}$/u);
  const toolManifestResult = await runCommand("tool-manifest-content", git, ["cat-file", "blob", toolBlob], {
    cwd: repoRoot,
    env: minimalEnv(),
    stdoutCap: 4 * 1024 * 1024,
  });
  assertNormal(toolManifestResult);
  const mainEvidence = JSON.parse(toolManifestResult.stdout);
  assert.equal(mainEvidence.candidate, CANDIDATE);
  assert.equal(Object.keys(mainEvidence.tools).length, 314);
  assert.equal(gitBlobId(toolManifestResult.stdout), toolBlob);

  const archivePath = join(runtimeRoot, `${CANDIDATE}.tar`);
  const archive = await runCommand("git-archive", git, [
    "archive",
    "--format=tar",
    `--output=${archivePath}`,
    CANDIDATE,
    ...SELECTED_INPUTS,
  ], { cwd: repoRoot, env: minimalEnv() });
  assertNormal(archive);
  const archiveBytes = await readFile(archivePath);

  const lsTree = await runCommand("selected-input-ls-tree", git, ["ls-tree", "-r", CANDIDATE, "--", ...SELECTED_INPUTS], {
    cwd: repoRoot,
    env: minimalEnv(),
  });
  assertNormal(lsTree);
  const expectedSources = parseLsTree(lsTree.stdout.toString());
  assert.ok(Object.keys(expectedSources).length > 100);
  const sourceRoot = join(runtimeRoot, "source");
  await mkdir(sourceRoot);
  const extraction = await runCommand("extract-source-archive", tar, ["-xf", archivePath, "-C", sourceRoot], {
    cwd: runtimeRoot,
    env: minimalEnv(),
  });
  assertNormal(extraction);
  const extractedSources = await walkFiles(sourceRoot);
  assert.deepEqual(Object.keys(extractedSources), Object.keys(expectedSources).sort((a, b) => a.localeCompare(b, "en")));
  const sourceAuthentication = {};
  for (const [path, expected] of Object.entries(expectedSources)) {
    const bytes = await readFile(join(sourceRoot, ...path.split("/")));
    assert.equal(gitBlobId(bytes), expected.gitBlob, `Git blob mismatch: ${path}`);
    assert.equal(extractedSources[path].mode, expected.mode, `mode mismatch: ${path}`);
    sourceAuthentication[path] = { ...expected, sha256: sha256(bytes), bytes: bytes.length };
  }
  await writeJson(join(outputRoot, "source-authentication.json"), {
    candidate: CANDIDATE,
    candidateTree: CANDIDATE_TREE,
    archive: { sha256: sha256(archiveBytes), bytes: archiveBytes.length, argv: archive.record.argv },
    selectedInputs: SELECTED_INPUTS,
    fileCount: Object.keys(sourceAuthentication).length,
    files: sourceAuthentication,
  });

  // Keep the authenticated tool tree at the isolated runtime ancestor so both
  // the archived source build and test-only consumers resolve its pinned types.
  const npmCli = await findNpmCli();
  const toolsRoot = join(runtimeRoot, "node_modules");
  let toolSourceRoot = join(repoRoot, "node_modules");
  let toolSource = { method: "authenticated-live-copy", root: toolSourceRoot, liveValidationFailure: null };
  let toolAuthentication;
  try {
    toolAuthentication = await authenticateToolTree(mainEvidence.tools, toolSourceRoot);
  } catch (error) {
    const bootstrapRoot = join(runtimeRoot, "tool-bootstrap");
    await mkdir(bootstrapRoot);
    await copyFile(join(sourceRoot, "package.json"), join(bootstrapRoot, "package.json"));
    await copyFile(join(sourceRoot, "package-lock.json"), join(bootstrapRoot, "package-lock.json"));
    const bootstrap = await runCommand("tool-bootstrap-npm-ci", process.execPath, [
      npmCli,
      "ci",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ], { cwd: bootstrapRoot, env: minimalEnv(), timeoutMs: 120_000 });
    assertNormal(bootstrap);
    toolSourceRoot = join(bootstrapRoot, "node_modules");
    toolAuthentication = await authenticateToolTree(mainEvidence.tools, toolSourceRoot);
    toolSource = {
      method: "isolated-npm-ci-from-authenticated-candidate-lock",
      root: toolSourceRoot,
      liveValidationFailure: error instanceof Error ? error.message : String(error),
      packageJsonSha256: extractedSources["package.json"].sha256,
      packageLockSha256: extractedSources["package-lock.json"].sha256,
    };
  }
  await copyAuthenticatedTools(toolAuthentication, toolSourceRoot, toolsRoot);
  const compilerFiles = ["typescript/bin/tsc", "typescript/lib/tsc.js", "typescript/lib/_tsc.js", "typescript/package.json"];
  const compilerAuthentication = Object.fromEntries(compilerFiles.map(path => [path, toolAuthentication[path]]));
  assert.ok(Object.values(compilerAuthentication).every(Boolean), "compiler implementation missing from pinned tools");
  await writeJson(join(outputRoot, "tool-authentication.json"), {
    sourceEvidenceCommit: MAIN_EVIDENCE,
    sourceEvidenceTree: MAIN_EVIDENCE_TREE,
    sourceEvidencePath: TOOL_MANIFEST_PATH,
    sourceEvidenceBlob: toolBlob,
    source: toolSource,
    fileCount: Object.keys(toolAuthentication).length,
    compiler: compilerAuthentication,
    files: toolAuthentication,
  });

  const tsc = join(toolsRoot, "typescript/bin/tsc");
  const build = await runCommand("candidate-build", process.execPath, [tsc, "--project", "tsconfig.build.json", "--pretty", "false"], {
    cwd: sourceRoot,
    env: minimalEnv(),
    timeoutMs: 120_000,
  });
  assertNormal(build);
  const distManifest = await walkFiles(join(sourceRoot, "dist"));
  await writeJson(join(outputRoot, "dist-manifest.json"), { fileCount: Object.keys(distManifest).length, files: distManifest });

  const packRoot = join(runtimeRoot, "pack");
  await mkdir(packRoot);
  const pack = await runCommand("npm-pack", process.execPath, [
    npmCli,
    "pack",
    "--json",
    "--ignore-scripts",
    `--pack-destination=${packRoot}`,
  ], { cwd: sourceRoot, env: minimalEnv(), timeoutMs: 60_000 });
  assertNormal(pack);
  const packJson = JSON.parse(pack.stdout);
  assert.equal(packJson.length, 1);
  const tgzPath = join(packRoot, packJson[0].filename);
  const tgzBytes = await readFile(tgzPath);
  const tgzSha256 = sha256(tgzBytes);
  const tgzSha512Integrity = `sha512-${sha512(tgzBytes)}`;
  assert.equal(packJson[0].integrity, tgzSha512Integrity);
  assert.equal(packJson[0].shasum, sha1(tgzBytes));
  const tarManifestPrefixed = parseTarGz(tgzBytes);
  const tarManifest = Object.fromEntries(Object.entries(tarManifestPrefixed).map(([path, value]) => {
    assert.ok(path.startsWith("package/"), `unexpected package tar path: ${path}`);
    return [path.slice("package/".length), value];
  }));

  const consumerA = join(runtimeRoot, "consumerA");
  await mkdir(consumerA);
  await writeJson(join(consumerA, "package.json"), { private: true, type: "module" });
  const install = await runCommand("npm-install-local-tarball", process.execPath, [
    npmCli,
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    "--offline",
    tgzPath,
  ], { cwd: consumerA, env: minimalEnv(), timeoutMs: 60_000 });
  assertNormal(install);
  const consumerB = join(runtimeRoot, "consumerB-moved");
  await rename(consumerA, consumerB);
  assert.equal(await exists(consumerA), false, "old consumer path still exists after move");
  const movedPackage = join(consumerB, "node_modules/virtual-bash");
  const movedManifest = await walkFiles(movedPackage, { includeRealpath: true });
  assert.deepEqual(contentProjection(movedManifest), contentProjection(tarManifest), "installed package differs from tarball");
  const movedDist = Object.fromEntries(Object.entries(movedManifest)
    .filter(([path]) => path.startsWith("dist/"))
    .map(([path, value]) => [path.slice(5), { sha256: value.sha256, bytes: value.bytes, mode: value.mode }]));
  assert.deepEqual(movedDist, distManifest, "installed dist differs from isolated build");
  const movedPackageRealpath = await realpath(movedPackage);
  for (const [path, value] of Object.entries(movedManifest)) {
    assert.ok(value.realpath.startsWith(`${movedPackageRealpath}${sep}`), `realpath escape: ${path}`);
  }
  await writeJson(join(outputRoot, "package-authentication.json"), {
    npmCli: { path: npmCli, sha256: await fileSha256(npmCli) },
    tarball: {
      filename: basename(tgzPath),
      sha256: tgzSha256,
      sha512Integrity: tgzSha512Integrity,
      npmReportedIntegrity: packJson[0].integrity,
      npmReportedShasum: packJson[0].shasum,
      verifiedSha1: sha1(tgzBytes),
      bytes: tgzBytes.length,
      fileCount: Object.keys(tarManifest).length,
    },
    move: { oldPath: consumerA, oldPathAbsent: true, newPath: consumerB },
    packageRoot: movedPackage,
    packageRootRealpath: movedPackageRealpath,
    builtDistFileCount: Object.keys(distManifest).length,
    installedFileCount: Object.keys(movedManifest).length,
    tarFiles: tarManifest,
    installedFiles: movedManifest,
    contentMatchesTar: true,
    distMatchesBuild: true,
    symlinksAllowed: false,
  });

  const positiveProbe = join(consumerB, "runtime-probe.mjs");
  await copyFile(join(harnessRoot, "runtime-probe.mjs"), positiveProbe);
  const positive = await guardRun("runtime-positive", positiveProbe, "positive", movedPackage, movedManifest);
  assertNormal(positive);
  const positiveJson = JSON.parse(positive.stdout);
  assert.equal(positiveJson.pass, true);
  assert.equal(positiveJson.registryCount, 70);
  assert.equal(positiveJson.treeCount, 1);
  assert.equal(positiveJson.treeStdout, ".\n└── file\n");
  assert.ok(fileURLToPath(positiveJson.rootUrl).startsWith(`${movedPackageRealpath}${sep}`));
  assert.ok(fileURLToPath(positiveJson.treeUrl).startsWith(`${movedPackageRealpath}${sep}`));
  const loadRecords = (await readFile(positive.logPath, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const authenticatedLoads = loadRecords.filter(item => item.event === "load");
  assert.ok(authenticatedLoads.length > 20, "too few authenticated module loads");
  assert.equal(loadRecords.some(item => item.event === "reject"), false);
  await writeJson(join(outputRoot, "loaded-module-authentication.json"), {
    loader: { path: join(harnessRoot, "guard-loader.mjs"), sha256: await fileSha256(join(harnessRoot, "guard-loader.mjs")) },
    packageRoot: movedPackage,
    packageRootRealpath: movedPackageRealpath,
    loadedRecordCount: authenticatedLoads.length,
    uniqueLoadedFiles: new Set(authenticatedLoads.map(item => item.relative)).size,
    records: loadRecords,
  });

  const wrongRoot = join(runtimeRoot, "wrong-consumer");
  const wrongPackage = join(wrongRoot, "node_modules/virtual-bash");
  await mkdir(wrongPackage, { recursive: true });
  await writeJson(join(wrongRoot, "package.json"), { private: true, type: "module" });
  await writeJson(join(wrongPackage, "package.json"), { name: "virtual-bash", version: "9.9.9", type: "module", exports: "./index.js" });
  await writeFile(join(wrongPackage, "index.js"), "export const marker = 'wrong-package';\n");
  const wrongProbe = join(wrongRoot, "runtime-probe.mjs");
  await copyFile(join(harnessRoot, "runtime-probe.mjs"), wrongProbe);
  const wrongPackageControl = await guardRun("control-wrong-package", wrongProbe, "wrong-package", movedPackage, movedManifest);
  const wrongPackageUrl = pathToFileURL(await realpath(join(wrongPackage, "index.js"))).href;
  const wrongExpected = `CONTROL_REJECTION VALIDATION_GUARD_OUTSIDE_PACKAGE: specifier=virtual-bash url=${wrongPackageUrl}\n`;
  assert.equal(wrongPackageControl.record.exit?.code, 23);
  assert.equal(wrongPackageControl.record.exit?.signal, null);
  assert.equal(wrongPackageControl.record.close?.code, 23);
  assert.equal(wrongPackageControl.record.close?.signal, null);
  assert.equal(wrongPackageControl.stderr.toString(), wrongExpected);
  assert.equal(wrongPackageControl.record.absentAfterClose, true);

  const outsideUrl = pathToFileURL(await realpath(join(sourceRoot, "src/index.ts"))).href;
  const outsideControl = await guardRun("control-outside-source", positiveProbe, "outside-source", movedPackage, movedManifest, {
    OUTSIDE_SOURCE_URL: outsideUrl,
  });
  const outsideExpected = `CONTROL_REJECTION VALIDATION_GUARD_OUTSIDE_PACKAGE: specifier=${outsideUrl} url=${outsideUrl}\n`;
  assert.equal(outsideControl.record.exit?.code, 23);
  assert.equal(outsideControl.record.exit?.signal, null);
  assert.equal(outsideControl.record.close?.code, 23);
  assert.equal(outsideControl.record.close?.signal, null);
  assert.equal(outsideControl.stderr.toString(), outsideExpected);
  assert.equal(outsideControl.record.absentAfterClose, true);

  const wrongHashControl = await guardRun("control-wrong-hash", positiveProbe, "wrong-hash", movedPackage, movedManifest, {}, config => {
    config.packageFiles["dist/index.js"] = "0".repeat(64);
  });
  const actualRootHash = movedManifest["dist/index.js"].sha256;
  const wrongHashExpected = `CONTROL_REJECTION VALIDATION_GUARD_HASH_MISMATCH: dist/index.js expected=${"0".repeat(64)} actual=${actualRootHash}\n`;
  assert.equal(wrongHashControl.record.exit?.code, 23);
  assert.equal(wrongHashControl.record.exit?.signal, null);
  assert.equal(wrongHashControl.record.close?.code, 23);
  assert.equal(wrongHashControl.record.close?.signal, null);
  assert.equal(wrongHashControl.stderr.toString(), wrongHashExpected);
  assert.equal(wrongHashControl.record.absentAfterClose, true);

  const baselineTypes = join(consumerB, "types-baseline");
  const baselineConfig = await writeTypeConsumer(baselineTypes, null, false);
  await writeJson(join(outputRoot, "configs/types-baseline.json"), baselineConfig);
  const typeArgv = [tsc, "--project", "tsconfig.json", "--pretty", "false", "--listFiles"];
  const typesBaseline = await runCommand("types-baseline-strict-library-check", process.execPath, typeArgv, {
    cwd: baselineTypes,
    env: minimalEnv(),
    timeoutMs: 60_000,
    stdoutCap: 2 * 1024 * 1024,
  });
  assertNormal(typesBaseline);
  const baselineListed = typesBaseline.stdout.toString().trim().split("\n");
  const rootDeclaration = join(movedPackageRealpath, "dist/index.d.ts");
  const treeDeclaration = join(movedPackageRealpath, "dist/commands/tree/index.d.ts");
  assert.ok(baselineListed.includes(rootDeclaration), "root declaration not loaded by compiler");
  assert.ok(baselineListed.includes(treeDeclaration), "tree declaration not loaded by compiler");

  const invalidRoot = join(runtimeRoot, "types-invalid");
  const invalidConfig = await writeTypeConsumer(invalidRoot, movedPackage, false);
  const invalidPackage = join(invalidRoot, "node_modules/virtual-bash");
  const invalidBefore = await walkFiles(invalidPackage);
  const invalidDeclaration = join(invalidPackage, "dist/index.d.ts");
  const originalDeclarationBytes = await readFile(invalidDeclaration);
  const injection = "\nexport declare const __validationChainInvalid: ValidationChainMissingType;\n";
  await writeFile(invalidDeclaration, Buffer.concat([originalDeclarationBytes, Buffer.from(injection)]));
  const invalidAfter = await walkFiles(invalidPackage);
  const changedFiles = Object.keys(invalidAfter).filter(path => invalidAfter[path].sha256 !== invalidBefore[path].sha256);
  assert.deepEqual(changedFiles, ["dist/index.d.ts"]);
  await writeJson(join(outputRoot, "configs/types-invalid-skip-false.json"), invalidConfig);
  const typesInvalid = await runCommand("types-invalid-library-check-active", process.execPath, typeArgv, {
    cwd: invalidRoot,
    env: minimalEnv(),
    timeoutMs: 60_000,
    stdoutCap: 2 * 1024 * 1024,
  });
  assert.notEqual(typesInvalid.record.exit?.code, 0);
  assert.equal(typesInvalid.record.exit?.signal, null);
  assert.equal(typesInvalid.record.close?.signal, null);
  assert.equal(typesInvalid.record.timedOut, false);
  assert.equal(typesInvalid.record.stdout.capExceeded, false);
  assert.equal(typesInvalid.record.stderr.capExceeded, false);
  assert.equal(typesInvalid.record.absentAfterClose, true);
  assert.match(typesInvalid.stdout.toString(), /ValidationChainMissingType/u);

  const skipConfig = structuredClone(invalidConfig);
  skipConfig.compilerOptions.skipLibCheck = true;
  await writeJson(join(invalidRoot, "tsconfig.json"), skipConfig);
  await writeJson(join(outputRoot, "configs/types-invalid-skip-true.json"), skipConfig);
  const typesInvalidSkipped = await runCommand("types-invalid-library-check-skipped", process.execPath, typeArgv, {
    cwd: invalidRoot,
    env: minimalEnv(),
    timeoutMs: 60_000,
    stdoutCap: 2 * 1024 * 1024,
  });
  assertNormal(typesInvalidSkipped);
  await writeJson(join(outputRoot, "typecheck-authentication.json"), {
    compiler: {
      executable: process.execPath,
      executableSha256: await fileSha256(process.execPath),
      entrypoint: tsc,
      entrypointSha256: await fileSha256(tsc),
      implementation: compilerAuthentication,
      argv: typeArgv,
    },
    baseline: {
      config: baselineConfig,
      status: typesBaseline.record.exit,
      rootDeclaration,
      rootDeclarationSha256: await fileSha256(rootDeclaration),
      treeDeclaration,
      treeDeclarationSha256: await fileSha256(treeDeclaration),
      loadedMovedPackageDeclarations: baselineListed.filter(path => path.startsWith(`${movedPackageRealpath}${sep}`)),
      pass: true,
    },
    faultInjection: {
      purpose: "test-only copied declaration fault; installed baseline package was not modified",
      copiedPackage: invalidPackage,
      injectedRelativePath: "dist/index.d.ts",
      injectedText: injection,
      beforeSha256: invalidBefore["dist/index.d.ts"].sha256,
      afterSha256: invalidAfter["dist/index.d.ts"].sha256,
      changedFiles,
      skipLibCheckFalse: { config: invalidConfig, status: typesInvalid.record.exit, failed: true },
      skipLibCheckTrue: { config: skipConfig, status: typesInvalidSkipped.record.exit, passed: true },
    },
  });

  const normalFailure = await runCommand("collector-normal-failure", process.execPath, [
    "-e",
    "process.stderr.write('VALIDATION_EXPECTED_FAILURE\\n'); process.exitCode = 19;",
  ], { cwd: runtimeRoot, env: minimalEnv(), timeoutMs: 5_000, stdoutCap: 4096, stderrCap: 4096 });
  assert.equal(normalFailure.record.exit?.code, 19);
  assert.equal(normalFailure.record.exit?.signal, null);
  assert.equal(normalFailure.record.close?.code, 19);
  assert.equal(normalFailure.record.close?.signal, null);
  assert.equal(normalFailure.stderr.toString(), "VALIDATION_EXPECTED_FAILURE\n");
  assert.equal(normalFailure.record.absentAfterClose, true);

  const overrun = await runCommand("collector-output-overrun", process.execPath, [
    "-e",
    "process.stdout.write('O'.repeat(65536)); setInterval(() => {}, 1000);",
  ], { cwd: runtimeRoot, env: minimalEnv(), timeoutMs: 5_000, stdoutCap: 4096, stderrCap: 4096 });
  assert.equal(overrun.record.stdout.capExceeded, true);
  assert.equal(overrun.record.stdout.storedBytes, 4096);
  assert.equal(overrun.record.stdout.truncated, true);
  assert.equal(overrun.record.killRequested, "stdout-cap");
  assert.equal(overrun.record.timedOut, false);
  assert.equal(overrun.record.close?.signal, "SIGKILL");
  assert.equal(overrun.record.absentAfterClose, true);

  const timeout = await runCommand("collector-timeout", process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
    cwd: runtimeRoot,
    env: minimalEnv(),
    timeoutMs: 250,
    stdoutCap: 4096,
    stderrCap: 4096,
  });
  assert.equal(timeout.record.timedOut, true);
  assert.equal(timeout.record.killRequested, "timeout");
  assert.equal(timeout.record.close?.signal, "SIGKILL");
  assert.equal(timeout.record.absentAfterClose, true);

  return {
    schema: 1,
    scope: "post-inspection validation-chain supplement; not a pre-source freeze or full native-parity/full-gate claim",
    candidate: { commit: CANDIDATE, tree: CANDIDATE_TREE, mutableHeadUsed: false, expectedDefaultCommands: 70 },
    supplements: { mainIndependentEvidence: MAIN_EVIDENCE, mainIndependentEvidenceTree: MAIN_EVIDENCE_TREE },
    source: {
      selectedInputCount: Object.keys(sourceAuthentication).length,
      gitArchiveSha256: sha256(archiveBytes),
      isolatedBuildDistFileCount: Object.keys(distManifest).length,
    },
    tools: { authenticatedFileCount: Object.keys(toolAuthentication).length, compiler: compilerAuthentication },
    package: {
      tarballSha256: tgzSha256,
      tarballSha512Integrity: tgzSha512Integrity,
      archiveFileCount: Object.keys(tarManifest).length,
      installedFileCount: Object.keys(movedManifest).length,
      movedOldPathAbsent: true,
      contentMatchesTar: true,
      distMatchesBuild: true,
      loadedModuleRecords: authenticatedLoads.length,
      uniqueLoadedModules: new Set(authenticatedLoads.map(item => item.relative)).size,
    },
    positive: { count: 2, checks: ["strict installed consumer compile", "guarded moved-package runtime registry/tree"] },
    expectedControls: {
      count: 8,
      checks: [
        "wrong package resolved outside moved package rejected",
        "outside archived source import rejected",
        "wrong expected package hash rejected",
        "invalid copied declaration fails with skipLibCheck false",
        "same invalid copied declaration succeeds with skipLibCheck true",
        "normal nonsignal failure exact status/diagnostic",
        "stdout collector overrun bounded and killed",
        "deadline timeout recorded and killed",
      ],
    },
    closure: {
      commandCount: commands.length,
      allCommandsReachedClose: commands.every(item => item.close !== null),
      allChildrenAbsentAfterClose: commands.every(item => item.absentAfterClose),
      workersCreated: 0,
      runtimeCleanupRecordedAfterResult: true,
    },
    productBugFound: false,
    harnessLimitations: [
      "This supplements rather than reruns the 139/139, 77/77, 34-pair, count-probe, and native holdout suites.",
      "The evidence is post-source inspection and does not supply a missing pre-source-commit freeze.",
      "The package closure guard authenticates modules actually loaded by this bounded root/tree runtime probe, not every export workflow.",
    ],
    commands,
    pass: true,
  };
}

async function finalizeEvidence(result) {
  cleanup.attempted = true;
  cleanup.liveChildrenAfterClose = commands.filter(item => !item.absentAfterClose).map(item => item.pid);
  if (runtimeRoot && runtimeRoot.startsWith(`${tmpdir()}${sep}safe-bash-validation-chain-`)) {
    await rm(runtimeRoot, { recursive: true, force: true });
    cleanup.runtimeAbsent = !(await exists(runtimeRoot));
  }
  result.cleanup = cleanup;
  if (result.closure) {
    result.closure.runtimeAbsentAfterCleanup = cleanup.runtimeAbsent;
    result.closure.allOwnRuntimeClean = cleanup.runtimeAbsent && cleanup.liveChildrenAfterClose.length === 0;
  }
  await writeJson(join(outputRoot, "RESULT.json"), result);
  const manifest = await walkFiles(outputRoot);
  const lines = Object.entries(manifest)
    .filter(([path]) => path !== "SHA256SUMS")
    .map(([path, value]) => `${value.sha256}  ${path}`);
  await writeFile(join(outputRoot, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

let result;
try {
  result = await execute();
} catch (error) {
  result = {
    schema: 1,
    scope: "post-inspection validation-chain supplement",
    candidate: { commit: CANDIDATE, tree: CANDIDATE_TREE, mutableHeadUsed: false },
    pass: false,
    failure: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    },
    commands,
  };
}

await finalizeEvidence(result);
if (!result.pass) {
  process.stderr.write(`${result.failure.name}: ${result.failure.message}\n`);
  process.exitCode = 1;
}
