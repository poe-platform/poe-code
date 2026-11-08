import { createHash, randomBytes } from "node:crypto";
import {
  cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProcessManager, waitForPidExit } from "./harness/process-manager.mjs";

const EXACT_CANDIDATE = "9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d";
const FROZEN_RELATIVE = "tests/integration/du-overlay-independent-20260827/approved-v8-9a5a6f92";
const materialized = process.argv[2] === "--materialized";
const offset = materialized ? 3 : 2;
const freezeCommit = process.argv[offset];
const candidate = process.argv[offset + 1];
const resultDirectory = resolve(process.argv[offset + 2] ?? "");
const nativeDu = resolve(process.argv[offset + 3] ?? "");
if (![freezeCommit, candidate].every(value => /^[0-9a-f]{40}$/u.test(value ?? ""))
  || !process.argv[offset + 2] || !process.argv[offset + 3]) {
  throw new Error("usage: node replay.mjs FREEZE_COMMIT CANDIDATE_COMMIT NEW_RESULT_SUBDIR NATIVE_GNU_DU");
}
if (candidate !== EXACT_CANDIDATE) throw new Error(`candidate must be exact ${EXACT_CANDIDATE}`);

const taskRoot = dirname(fileURLToPath(import.meta.url));
const repository = resolve(materialized ? process.env.V6_REPOSITORY ?? "" : join(taskRoot, "../../../.."));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const gitBlob = bytes => createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const processManager = new ProcessManager({ defaultTimeoutMs: 120_000, termGraceMs: 750, closureTimeoutMs: 2_500 });
processManager.installSignalHandlers();
const run = (command, args, options = {}) => processManager.run(command, args, { cwd: repository, ...options });

async function success(result, label) {
  if (result.timedOut || result.spawnError || result.status !== 0 || !result.closure.rootPidGone || !result.closure.groupGone) {
    throw new Error(`${label} failed (${result.status}, timeout=${result.timedOut}, spawn=${result.spawnError ?? "none"}): ${result.stderr.toString()}`);
  }
  return result;
}

async function failure(result, label) {
  if (result.timedOut || result.spawnError || result.status === 0 || !result.closure.rootPidGone || !result.closure.groupGone) {
    throw new Error(`${label} did not produce a bounded ordinary failure`);
  }
  return result;
}

function admitNoAgents(paths, phase) {
  const forbidden = paths.filter(path => /(^|\/)AGENTS\.md$/u.test(path));
  if (forbidden.length) throw new Error(`${phase}: forbidden AGENTS inventory: ${forbidden.join(", ")}`);
  return { phase, admitted: true, count: paths.length, forbidden: [] };
}

function executableNegativeAdmissionControl() {
  let writes = 0;
  let rejected = false;
  try {
    admitNoAgents(["package.json", "src/AGENTS.md"], "synthetic-negative-before-write");
    writes++;
  } catch (error) {
    rejected = /forbidden AGENTS inventory/u.test(String(error));
  }
  if (!rejected || writes !== 0) throw new Error("AGENTS negative admission control did not reject before write");
  return { rejected, writes, forbiddenPathWasNeverCreated: true };
}

function safeRelativePath(path, phase) {
  if (typeof path !== "string" || !path || path.includes("\\") || path.includes("\0")
    || path.startsWith("/") || path.split("/").some(part => part === "" || part === "." || part === "..")) {
    throw new Error(`${phase}: unsafe archive path ${JSON.stringify(path)}`);
  }
  return path;
}

function admitPackPlan(packRecord, allowedInventory, phase) {
  if (!packRecord || !Array.isArray(packRecord.files)) throw new Error(`${phase}: npm did not return a file plan`);
  const allowed = new Map(allowedInventory.map(file => [file.path, file]));
  const seen = new Set();
  const files = packRecord.files.map(file => {
    const path = safeRelativePath(file.path, phase);
    if (seen.has(path)) throw new Error(`${phase}: duplicate planned path ${path}`);
    seen.add(path);
    const source = allowed.get(path);
    if (!source || source.bytes !== file.size) throw new Error(`${phase}: unexpected or size-mismatched planned path ${path}`);
    return { path, size: file.size, mode: file.mode };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  admitNoAgents(files.map(file => file.path), phase);
  if (!files.some(file => file.path === "package.json")) throw new Error(`${phase}: package.json is absent from planned archive`);
  return {
    phase,
    admitted: true,
    completePlannedFileCount: files.length,
    files,
    tarPaths: files.map(file => `package/${file.path}`).sort(),
  };
}

function executableInvalidPacklistControl() {
  const counts = { archiveCreations: 0, writes: 0, extractions: 0 };
  let rejected = false;
  try {
    admitPackPlan(
      { files: [{ path: "synthetic/AGENTS.md", size: 7, mode: 0o644 }] },
      [{ path: "synthetic/AGENTS.md", bytes: 7, sha256: "in-memory-only" }],
      "synthetic-invalid-packlist-before-archive",
    );
    counts.archiveCreations++;
    counts.writes++;
    counts.extractions++;
  } catch (error) {
    rejected = /forbidden AGENTS inventory/u.test(String(error));
  }
  if (!rejected || Object.values(counts).some(count => count !== 0)) {
    throw new Error("synthetic invalid packlist was not rejected before archive/write/extraction");
  }
  return { rejected, ...counts, forbiddenPathWasNeverCreated: true };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const answer = {};
    for (const [key, child] of Object.entries(value)) {
      if (["extractedRoot", "moduleRoot", "atimeMs", "mtimeMs", "ctimeMs", "birthtimeMs"].includes(key)) continue;
      answer[key] = canonicalize(child);
    }
    return answer;
  }
  return typeof value === "string"
    ? value.replaceAll(/\.virtual-bash-overlay-[0-9a-f-]+/gu, ".virtual-bash-overlay-<UUID>")
    : value;
}

async function gitBytes(revision, path) {
  return (await success(await run("git", ["show", `${revision}:${path}`]), `read ${path} from ${revision}`)).stdout;
}

async function gitPaths(revision, path) {
  const output = (await success(await run("git", ["ls-tree", "-r", "--name-only", revision, "--", path]), `list ${path}`)).stdout.toString();
  return output.split("\n").filter(Boolean);
}

async function tarPaths(path, compressed = false) {
  const args = compressed ? ["-tzf", path] : ["-tf", path];
  const output = (await success(await run("tar", args), `list archive ${path}`)).stdout.toString();
  return output.split("\n").filter(item => item && !item.endsWith("/"));
}

async function inventory(root, exclusions = new Set()) {
  const answer = [];
  const visit = async absolute => {
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      const path = join(absolute, entry.name);
      const local = relative(root, path).replaceAll("\\", "/");
      if (exclusions.has(local.split("/")[0])) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        answer.push({ path: local, bytes: bytes.byteLength, sha256: sha256(bytes) });
      } else throw new Error(`unsupported inventory entry ${local}`);
    }
  };
  await visit(root);
  return answer.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function processMetadata(result) {
  return {
    command: result.command,
    args: result.args,
    cwd: result.cwd,
    status: result.status,
    signal: result.signal,
    pid: result.pid,
    pgid: result.pgid,
    timedOut: result.timedOut,
    interruptedBy: result.interruptedBy,
    spawnError: result.spawnError,
    terminationReason: result.terminationReason,
    termination: result.termination,
    closure: result.closure,
    timeoutMs: result.timeoutMs,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    stdoutSha256: sha256(result.stdout),
    stderrSha256: sha256(result.stderr),
  };
}

async function writeProcessHistory(directory, label) {
  const historyDirectory = join(directory, label);
  await mkdir(historyDirectory, { recursive: false });
  const records = [];
  for (const [index, result] of processManager.history.entries()) {
    const stem = `${String(index + 1).padStart(3, "0")}`;
    await writeFile(join(historyDirectory, `${stem}.stdout`), result.stdout, { flag: "wx" });
    await writeFile(join(historyDirectory, `${stem}.stderr`), result.stderr, { flag: "wx" });
    const record = { sequence: index + 1, ...processMetadata(result) };
    await writeFile(join(historyDirectory, `${stem}.json`), json(record), { flag: "wx" });
    records.push(record);
  }
  await writeFile(join(historyDirectory, "INDEX.json"), json({ label, records }), { flag: "wx" });
  return records;
}

async function frozenManifest() {
  const bytes = await gitBytes(freezeCommit, `${FROZEN_RELATIVE}/MANIFEST.json`);
  const manifestBlob = (await success(await run("git", ["rev-parse", `${freezeCommit}:${FROZEN_RELATIVE}/MANIFEST.json`]), "manifest blob")).stdout.toString().trim();
  if (gitBlob(bytes) !== manifestBlob) throw new Error("manifest Git blob identity mismatch");
  const manifest = JSON.parse(bytes.toString());
  const tree = await gitPaths(freezeCommit, FROZEN_RELATIVE);
  admitNoAgents(tree, "freeze-pre-archive");
  const expected = [...manifest.files.map(file => `${FROZEN_RELATIVE}/${file.path}`), `${FROZEN_RELATIVE}/MANIFEST.json`].sort();
  if (JSON.stringify(tree.sort()) !== JSON.stringify(expected)) throw new Error("freeze tree differs from complete manifest inventory");
  for (const file of manifest.files) {
    const path = `${FROZEN_RELATIVE}/${file.path}`;
    const fileBytes = await gitBytes(freezeCommit, path);
    const blob = (await success(await run("git", ["rev-parse", `${freezeCommit}:${path}`]), `blob ${path}`)).stdout.toString().trim();
    if (sha256(fileBytes) !== file.sha256 || blob !== file.gitBlob || fileBytes.byteLength !== file.bytes) {
      throw new Error(`frozen input mismatch: ${file.path}`);
    }
  }
  return { manifest, tree, bytes, manifestBlob };
}

async function verifyMaterializedTree(freeze, phase, root = taskRoot) {
  const actual = await inventory(root);
  const expected = [...freeze.manifest.files, {
    path: "MANIFEST.json",
    bytes: freeze.bytes.byteLength,
    sha256: sha256(freeze.bytes),
    gitBlob: freeze.manifestBlob,
  }].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (actual.length !== expected.length) throw new Error(`${phase}: materialized frozen inventory count mismatch`);
  for (let index = 0; index < expected.length; index++) {
    const wanted = expected[index];
    const found = actual[index];
    if (found.path !== wanted.path || found.bytes !== wanted.bytes || found.sha256 !== wanted.sha256) {
      throw new Error(`${phase}: materialized frozen byte mismatch at ${wanted.path}`);
    }
    const bytes = await readFile(join(root, wanted.path));
    if (gitBlob(bytes) !== wanted.gitBlob) throw new Error(`${phase}: materialized frozen Git blob mismatch at ${wanted.path}`);
  }
  return {
    phase,
    completeFileCount: actual.length,
    everyByteSizeSha256AndGitBlobVerified: true,
    exactInventoryNoNewOrDeletedEntries: true,
    inventorySha256: sha256(Buffer.from(json(actual))),
  };
}

async function selectedCandidatePaths(manifest) {
  const bytes = await gitBytes(freezeCommit, `${FROZEN_RELATIVE}/config/candidate-selected-paths.txt`);
  const fileRecord = manifest.files.find(file => file.path === "config/candidate-selected-paths.txt");
  if (!fileRecord || sha256(bytes) !== fileRecord.sha256) throw new Error("selected candidate path list is not frozen");
  const selected = bytes.toString().split("\n").filter(Boolean);
  admitNoAgents(selected, "candidate-pre-archive");
  const actual = (await success(await run("git", ["ls-tree", "-r", "--name-only", candidate, "--", ...selected]), "candidate selected tree")).stdout.toString().split("\n").filter(Boolean);
  if (JSON.stringify(actual) !== JSON.stringify(selected)) throw new Error("candidate selected inventory does not resolve exactly");
  return selected;
}

async function executeBootstrap() {
  const repositoryReal = await realpath(repository);
  try { await stat(resultDirectory); throw new Error("result subdir already exists"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!resultDirectory.startsWith(`${repositoryReal}/`) || resultDirectory.startsWith(`${resolve(repositoryReal, FROZEN_RELATIVE)}/`)) {
    throw new Error("result subdir must be a new separately owned path inside this repository and outside frozen bytes");
  }
  await mkdir(resultDirectory, { recursive: false });
  let bootstrapScratch;
  let protocolError;
  let child;
  try {
    const gitRoot = (await success(await run("git", ["rev-parse", "--show-toplevel"]), "repository root")).stdout.toString().trim();
    if (await realpath(gitRoot) !== repositoryReal) throw new Error("wrong repository root");
    const resolvedFreeze = (await success(await run("git", ["rev-parse", `${freezeCommit}^{commit}`]), "freeze resolution")).stdout.toString().trim();
    const resolvedCandidate = (await success(await run("git", ["rev-parse", `${candidate}^{commit}`]), "candidate resolution")).stdout.toString().trim();
    if (resolvedFreeze !== freezeCommit || resolvedCandidate !== candidate) throw new Error("mutable or mismatched revision resolution");
    const freeze = await frozenManifest();
    await selectedCandidatePaths(freeze.manifest);
    const admissionControl = executableNegativeAdmissionControl();
    const packlistControl = executableInvalidPacklistControl();
    const ownBytes = await readFile(fileURLToPath(import.meta.url));
    const ownRecord = freeze.manifest.files.find(file => file.path === "replay.mjs");
    if (!ownRecord || sha256(ownBytes) !== ownRecord.sha256 || gitBlob(ownBytes) !== ownRecord.gitBlob) {
      throw new Error("bootstrap runner bytes differ from freeze commit");
    }
    bootstrapScratch = await mkdir(join(resultDirectory, "bootstrap-scratch"), { recursive: false }).then(() => join(resultDirectory, "bootstrap-scratch"));
    const archive = join(bootstrapScratch, "freeze.tar");
    await success(await run("git", ["archive", "--format=tar", `--output=${archive}`, freezeCommit, "--", FROZEN_RELATIVE]), "freeze archive");
    const archivePaths = await tarPaths(archive);
    admitNoAgents(archivePaths, "freeze-pre-extraction");
    if (JSON.stringify(archivePaths.sort()) !== JSON.stringify(freeze.tree.sort())) throw new Error("freeze archive inventory mismatch");
    const extracted = join(bootstrapScratch, "extracted");
    await mkdir(extracted);
    await success(await run("tar", ["-xf", archive, "-C", extracted]), "freeze extraction");
    const extractedRoot = join(extracted, FROZEN_RELATIVE);
    const materializedBeforeChild = await verifyMaterializedTree(freeze, "bootstrap-materialized-before-child", extractedRoot);
    await writeFile(join(resultDirectory, "bootstrap.json"), json({
      freezeCommit,
      candidate,
      admissionControl,
      packlistControl,
      freezeManifestSha256: sha256(freeze.bytes),
      freezeArchiveSha256: sha256(await readFile(archive)),
      materializedBeforeChild,
    }), { flag: "wx" });
    const frozenRunner = join(extractedRoot, "replay.mjs");
    child = await run(process.execPath, [frozenRunner, "--materialized", freezeCommit, candidate, resultDirectory, nativeDu], {
      env: { ...process.env, V6_REPOSITORY: repositoryReal },
      timeoutMs: 1_800_000,
      termGraceMs: 2_000,
      closureTimeoutMs: 5_000,
    });
    const materializedAfterChild = await verifyMaterializedTree(freeze, "bootstrap-materialized-after-child", extractedRoot);
    await writeFile(join(resultDirectory, "BOOTSTRAP-POSTCHECK.json"), json({ materializedAfterChild }), { flag: "wx" });
    if (child.timedOut || child.spawnError || child.status !== 0 || !child.closure.groupGone) {
      throw new Error(`materialized replay failed (${child.status}, timeout=${child.timedOut})`);
    }
    await rm(bootstrapScratch, { recursive: true, force: true });
    let scratchExists = true;
    try { await stat(bootstrapScratch); }
    catch (error) { if (error.code === "ENOENT") scratchExists = false; else throw error; }
    if (scratchExists) throw new Error("bootstrap scratch remained after cleanup");
    bootstrapScratch = undefined;
    await writeFile(join(resultDirectory, "BOOTSTRAP-CLOSED.json"), json({ removed: true, everyOwnedProcessClosed: true }), { flag: "wx" });
  } catch (error) {
    protocolError = error;
    await writeFile(join(resultDirectory, "BOOTSTRAP-ERROR.txt"), `${error.stack ?? error}\n`, { flag: "wx" });
  } finally {
    await processManager.shutdown(protocolError ? "bootstrap-failure" : "bootstrap-complete");
    if (processManager.interruptedBy && !protocolError) {
      protocolError = new Error(`bootstrap interrupted by ${processManager.interruptedBy}`);
      await writeFile(join(resultDirectory, "BOOTSTRAP-ERROR.txt"), `${protocolError.stack ?? protocolError}\n`, { flag: "wx" });
    }
    await writeProcessHistory(resultDirectory, "bootstrap-processes");
    const closure = processManager.assertClosed();
    await writeFile(join(resultDirectory, "BOOTSTRAP-PROCESS-CLOSURE.json"), json({ closure, retainedScratch: bootstrapScratch }), { flag: "wx" });
    if (child) {
      process.stdout.write(child.stdout);
      process.stderr.write(child.stderr);
    }
  }
  if (protocolError) process.exitCode = 1;
}

async function executeMaterialized() {
  const startedAt = new Date().toISOString();
  const evidence = join(resultDirectory, `run-${startedAt.replaceAll(":", "").replaceAll(".", "")}-${randomBytes(3).toString("hex")}`);
  if (evidence === taskRoot || evidence.startsWith(`${taskRoot}/`)) throw new Error("evidence must remain outside the materialized frozen input tree");
  await mkdir(evidence);
  const scratch = await mkdtemp(join(resultDirectory, "work-"));
  const steps = [];
  let protocolError;
  let freeze;
  let materializedBefore;
  let materializedAfterCases;
  let materializedAfterCleanup;
  let scratchRemoved = false;
  let resultManifest;
  const mutantCopyCleanup = [];
  const removeOwnedCopy = async (path, label) => {
    if (!(path === scratch || path.startsWith(`${scratch}/`))) throw new Error(`refusing cleanup outside owned scratch: ${path}`);
    await rm(path, { recursive: true, force: true });
    let exists = true;
    try { await stat(path); }
    catch (error) { if (error.code === "ENOENT") exists = false; else throw error; }
    if (exists) throw new Error(`${label} remained after cleanup`);
    mutantCopyCleanup.push({ label, path, actualPostCleanupStat: "ENOENT" });
  };
  const save = async (name, result) => {
    await writeFile(join(evidence, `${name}.stdout`), result.stdout, { flag: "wx" });
    await writeFile(join(evidence, `${name}.stderr`), result.stderr, { flag: "wx" });
    const record = { name, ...processMetadata(result) };
    await writeFile(join(evidence, `${name}.json`), json(record), { flag: "wx" });
    steps.push(record);
    return result;
  };
  try {
    freeze = await frozenManifest();
    materializedBefore = await verifyMaterializedTree(freeze, "materialized-before-cases");
    await writeFile(join(evidence, "materialized-before.json"), json(materializedBefore), { flag: "wx" });
    const selected = await selectedCandidatePaths(freeze.manifest);
    const timeoutControl = await save("process-timeout-grandchild-control", await run(
      process.execPath,
      [join(taskRoot, "harness", "process-timeout-control.mjs"), "grandchild"],
      { timeoutMs: 1_500, termGraceMs: 250, closureTimeoutMs: 3_000 },
    ));
    if (!timeoutControl.timedOut || !timeoutControl.closure.groupGone || timeoutControl.status === 0) {
      throw new Error("timeout/grandchild control did not time out and close its owned group");
    }
    const timeoutLine = timeoutControl.stdout.toString().split("\n").find(Boolean);
    const timeoutPids = JSON.parse(timeoutLine ?? "null");
    if (timeoutPids?.controlPid !== timeoutControl.pid || !Number.isSafeInteger(timeoutPids?.grandchildPid)
      || timeoutPids.grandchildPid < 1 || !await waitForPidExit(timeoutPids.grandchildPid, 3_000)) {
      throw new Error("timeout/grandchild control left an owned descendant pid alive");
    }
    await writeFile(join(evidence, "process-timeout-grandchild-closure.json"), json({
      rootPid: timeoutControl.pid,
      ownedPgid: timeoutControl.pgid,
      grandchildPid: timeoutPids.grandchildPid,
      timedOut: true,
      rootPidGone: true,
      ownedGroupGone: true,
      grandchildPidGone: true,
    }), { flag: "wx" });
    const indexBefore = await success(await run("git", ["diff", "--cached", "--binary"]), "foreign index before");
    const indexBeforeSha256 = sha256(indexBefore.stdout);
    const archive = join(scratch, "candidate.tar");
    await save("candidate-archive", await success(await run("git", ["archive", "--format=tar", `--output=${archive}`, candidate, "--", ...selected]), "candidate archive"));
    const archivePaths = await tarPaths(archive);
    admitNoAgents(archivePaths, "candidate-pre-extraction");
    if (JSON.stringify(archivePaths.sort()) !== JSON.stringify([...selected].sort())) throw new Error("candidate archive path mismatch");
    const source = join(scratch, "source");
    await mkdir(source);
    await save("candidate-extract", await success(await run("tar", ["-xf", archive, "-C", source]), "candidate extraction"));
    const inputsBefore = await inventory(source);
    if (JSON.stringify(inputsBefore.map(item => item.path)) !== JSON.stringify(selected)) throw new Error("extracted candidate inventory mismatch");
    await writeFile(join(evidence, "candidate-inputs-before.json"), json(inputsBefore), { flag: "wx" });
    const productPackage = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    const dependencyFields = ["dependencies", "optionalDependencies", "peerDependencies"];
    for (const field of dependencyFields) {
      if (Object.keys(productPackage[field] ?? {}).length !== 0) throw new Error(`candidate package has unexpected ${field}`);
    }
    if ((productPackage.bundledDependencies ?? productPackage.bundleDependencies ?? []).length !== 0) {
      throw new Error("candidate package has unexpected bundled dependencies");
    }

    const tsc = join(repository, "node_modules", ".bin", "tsc");
    const nodeRealpath = await realpath(process.execPath);
    const tscRealpath = await realpath(tsc);
    const npmPath = (await success(await run("which", ["npm"]), "resolve npm executable")).stdout.toString().trim();
    const npmRealpath = await realpath(npmPath);
    const tsxPackagePath = join(repository, "node_modules", "tsx", "package.json");
    const tsxPackageBytes = await readFile(tsxPackagePath);
    const toolIdentities = {
      node: { realpath: nodeRealpath, sha256: sha256(await readFile(nodeRealpath)), version: (await success(await run(process.execPath, ["--version"]), "node version")).stdout.toString().trim() },
      npm: { realpath: npmRealpath, sha256: sha256(await readFile(npmRealpath)), version: (await success(await run("npm", ["--version"]), "npm version")).stdout.toString().trim() },
      typescript: { realpath: tscRealpath, sha256: sha256(await readFile(tscRealpath)), version: (await success(await run(tsc, ["--version"]), "TypeScript version")).stdout.toString().trim() },
      tsxPackage: { path: tsxPackagePath, sha256: sha256(tsxPackageBytes), version: JSON.parse(tsxPackageBytes.toString()).version },
    };
    await save("build", await success(await run(tsc, ["-p", join(source, "tsconfig.build.json")]), "candidate build"));
    const sourceOriginal = await save("source-original", await success(await run(process.execPath, [join(taskRoot, "harness", "verify-original.mjs"), source]), "source original suite"));
    const sourceV5 = await save("source-v5", await success(await run(process.execPath, [join(taskRoot, "harness", "verify-v5.mjs"), source, scratch]), "source v5 suite"));
    const sourceOriginalJson = JSON.parse(sourceOriginal.stdout.toString());
    const sourceV5Json = JSON.parse(sourceV5.stdout.toString());

    const regressionFiles = [
      "tests/commands/du/behavior.test.ts",
      "tests/commands/du/backends.test.ts",
      "tests/fs/overlay/allocation.test.ts",
      "tests/fs/overlay/adversarial.test.ts",
    ];
    await save("scoped-regressions", await success(await run(process.execPath, ["--import", "tsx", "--test", ...regressionFiles], { cwd: source }), "precisely named DU/overlay regressions"));

    const npmEnv = {
      ...process.env,
      npm_config_cache: join(scratch, "npm-cache"),
      npm_config_userconfig: "/dev/null",
      npm_config_update_notifier: "false",
      npm_config_registry: "http://127.0.0.1:9/",
    };
    const selectedInputsPrePack = await inventory(source, new Set(["dist"]));
    if (JSON.stringify(selectedInputsPrePack) !== JSON.stringify(inputsBefore)) {
      throw new Error("candidate selected inputs changed before npm pack admission");
    }
    const packInputInventory = await inventory(source);
    admitNoAgents(packInputInventory.map(file => file.path), "npm-pack-input-pre-dry-run");
    const archivesBeforeDryRun = (await readdir(scratch)).filter(path => path.endsWith(".tgz")).sort();
    const dryPack = await save("npm-pack-dry-run", await success(await run(
      "npm",
      ["pack", "--dry-run", "--ignore-scripts", "--json", "--pack-destination", scratch],
      { cwd: source, env: npmEnv },
    ), "npm pack dry-run"));
    const archivesAfterDryRun = (await readdir(scratch)).filter(path => path.endsWith(".tgz")).sort();
    if (JSON.stringify(archivesBeforeDryRun) !== JSON.stringify(archivesAfterDryRun)) {
      throw new Error("npm pack dry-run created an archive before packlist admission");
    }
    const dryPackRecords = JSON.parse(dryPack.stdout.toString());
    if (!Array.isArray(dryPackRecords) || dryPackRecords.length !== 1) throw new Error("npm pack dry-run returned an unexpected record count");
    const admittedPackPlan = admitPackPlan(dryPackRecords[0], packInputInventory, "npm-packlist-pre-archive");
    const invalidPacklistControl = executableInvalidPacklistControl();
    await writeFile(join(evidence, "npm-packlist-pre-archive-admission.json"), json({
      dryRunCreatedArchiveCount: 0,
      admittedPackPlan,
      invalidPacklistControl,
    }), { flag: "wx" });
    const pack = await save("npm-pack", await success(await run(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch],
      { cwd: source, env: npmEnv },
    ), "npm pack"));
    const packRecord = JSON.parse(pack.stdout.toString())[0];
    safeRelativePath(packRecord.filename, "npm-pack-actual-filename");
    if (packRecord.filename.includes("/")) throw new Error("npm pack returned a nested archive filename");
    const actualPackPlan = admitPackPlan(packRecord, packInputInventory, "npm-pack-actual-record-pre-extraction");
    if (JSON.stringify(actualPackPlan.files) !== JSON.stringify(admittedPackPlan.files)) {
      throw new Error("actual npm pack record differs from the pre-pack admitted file plan");
    }
    const tarball = join(scratch, packRecord.filename);
    const packedPaths = await tarPaths(tarball, true);
    admitNoAgents(packedPaths, "npm-package-pre-extraction");
    if (JSON.stringify([...packedPaths].sort()) !== JSON.stringify(admittedPackPlan.tarPaths)) {
      throw new Error("actual npm tar inventory differs from the pre-pack admitted list");
    }
    const tarballSha256 = sha256(await readFile(tarball));
    const unpacked = join(scratch, "unpacked");
    await mkdir(unpacked);
    await save("npm-extract", await success(await run("tar", ["-xzf", tarball, "-C", unpacked]), "npm package extraction"));
    const packedInventory = await inventory(join(unpacked, "package"));
    const packInputByPath = new Map(packInputInventory.map(file => [file.path, file]));
    if (packedInventory.length !== admittedPackPlan.files.length || packedInventory.some(file => {
      const sourceFile = packInputByPath.get(file.path);
      return !sourceFile || sourceFile.bytes !== file.bytes || sourceFile.sha256 !== file.sha256;
    })) throw new Error("extracted npm package bytes differ from the admitted pre-pack inputs");
    await writeFile(join(evidence, "packed-files.json"), json(packedInventory), { flag: "wx" });

    const stagingConsumer = join(scratch, "consumer-staging");
    const consumerInventory = await inventory(join(taskRoot, "consumer"));
    admitNoAgents(consumerInventory.map(item => item.path), "consumer-pre-copy");
    await cp(join(taskRoot, "consumer"), stagingConsumer, { recursive: true, errorOnExist: true });
    const dependencyArchiveAdmission = {
      beforeInstall: true,
      offline: true,
      admittedArchives: [{ path: tarball, sha256: tarballSha256, completeTarPaths: admittedPackPlan.tarPaths }],
      implicitRegistryArchives: 0,
      productionDependencyCount: 0,
      optionalDependencyCount: 0,
      peerDependencyCount: 0,
      bundledDependencyCount: 0,
    };
    await writeFile(join(evidence, "dependency-archive-pre-install-admission.json"), json(dependencyArchiveAdmission), { flag: "wx" });
    await save("consumer-install", await success(await run(
      "npm",
      ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--no-save", "--package-lock=false", "--omit=dev", tarball],
      { cwd: stagingConsumer, env: npmEnv },
    ), "consumer install"));
    if (sha256(await readFile(tarball)) !== tarballSha256) throw new Error("admitted package archive changed during npm install");
    const movedConsumer = join(scratch, "relocated", "consumer");
    await mkdir(dirname(movedConsumer), { recursive: true });
    await rename(stagingConsumer, movedConsumer);
    const installedPackage = await realpath(join(movedConsumer, "node_modules", "virtual-bash"));
    const installedInventory = await inventory(installedPackage);
    if (JSON.stringify(installedInventory) !== JSON.stringify(packedInventory)) throw new Error("installed package differs from complete packed file inventory");
    await writeFile(join(evidence, "installed-files.json"), json(installedInventory), { flag: "wx" });
    await save("consumer-strict-types", await success(await run(tsc, ["-p", join(movedConsumer, "tsconfig.json")], { cwd: movedConsumer }), "strict NodeNext moved consumer"));
    await save("consumer-runtime", await success(await run(process.execPath, [join(movedConsumer, "runtime.mjs")], { cwd: movedConsumer }), "moved consumer runtime"));

    const loader = join(taskRoot, "harness", "attest-loader.mjs");
    const packageRuns = {};
    for (const [name, verifier] of [["original", "verify-original.mjs"], ["v5", "verify-v5.mjs"]]) {
      const log = join(evidence, `package-${name}-loads.jsonl`);
      const args = ["--experimental-loader", loader, join(taskRoot, "harness", verifier), installedPackage];
      if (name === "v5") args.push(scratch);
      const result = await save(`package-${name}`, await success(await run(process.execPath, args, { cwd: movedConsumer, env: { ...process.env, DU_OVERLAY_ATTEST_LOG: log, DU_OVERLAY_EXPECTED_MODULE_ROOT: installedPackage } }), `moved package ${name} suite`));
      packageRuns[name] = JSON.parse(result.stdout.toString());
    }
    if (JSON.stringify(canonicalize({ summary: sourceOriginalJson.summary, results: sourceOriginalJson.results }))
        !== JSON.stringify(canonicalize({ summary: packageRuns.original.summary, results: packageRuns.original.results }))
      || JSON.stringify(sourceV5Json.parityProjection) !== JSON.stringify(packageRuns.v5.parityProjection)) throw new Error("source and moved package suite projections differ");
    const loadRecords = [];
    for (const name of ["original", "v5"]) {
      const text = await readFile(join(evidence, `package-${name}-loads.jsonl`), "utf8");
      loadRecords.push(...text.split("\n").filter(Boolean).map(line => JSON.parse(line)));
    }
    const physicalLoads = loadRecords.filter(record => record.path.startsWith(`${installedPackage}/dist/`));
    for (const record of physicalLoads) {
      if (!record.sourceSha256 || record.sourceSha256 !== sha256(await readFile(record.path))) throw new Error(`nextLoad source-byte attestation failed: ${record.path}`);
    }
    for (const required of ["dist/commands/du/index.js", "dist/fs/overlay/index.js", "dist/fs/real/index.js"]) {
      if (!physicalLoads.some(record => record.path === join(installedPackage, required))) throw new Error(`required physical module was not loaded: ${required}`);
    }
    await writeFile(join(evidence, "next-load-attestation.json"), json({ records: physicalLoads, everySourceByteHashMatchesDisk: true }), { flag: "wx" });

    const guardedCopy = async (sourcePath, destination, label) => {
      const entries = await inventory(sourcePath);
      admitNoAgents(entries.map(item => item.path), `${label}-pre-copy`);
      await cp(sourcePath, destination, { recursive: true, errorOnExist: true });
    };
    const wrongRoot = await save("negative-wrong-root", await run(process.execPath, ["--experimental-loader", loader, join(taskRoot, "harness", "verify-v5.mjs"), source, scratch], { cwd: movedConsumer, env: { ...process.env, DU_OVERLAY_ATTEST_LOG: join(evidence, "wrong-root-loads.jsonl"), DU_OVERLAY_EXPECTED_MODULE_ROOT: installedPackage } }));
    await failure(wrongRoot, "wrong-root/source-fallback guard");

    const missingConsumer = join(scratch, "negative-missing-du");
    try {
      await guardedCopy(movedConsumer, missingConsumer, "missing-du-consumer");
      const missingPackage = await realpath(join(missingConsumer, "node_modules", "virtual-bash"));
      await rename(join(missingPackage, "dist", "commands", "du", "index.js"), join(missingPackage, "dist", "commands", "du", "index.js.disabled"));
      await failure(await save("negative-missing-du", await run(process.execPath, [join(taskRoot, "harness", "verify-v5.mjs"), missingPackage, scratch], { cwd: missingConsumer })), "missing installed DU guard");
    } finally {
      await removeOwnedCopy(missingConsumer, "missing-DU mutant copy");
    }

    const mutantConsumer = join(scratch, "negative-restored-cleanup");
    try {
      await guardedCopy(movedConsumer, mutantConsumer, "restored-cleanup-consumer");
      const mutantPackage = await realpath(join(mutantConsumer, "node_modules", "virtual-bash"));
      const overlayPath = join(mutantPackage, "dist", "fs", "overlay", "index.js");
      const overlayText = await readFile(overlayPath, "utf8");
      const pureLine = "return this.run(options, async () => this.listing(await this.required(path, options), options), false);";
      if (!overlayText.includes(pureLine)) throw new Error("restored cleanup mutant target missing");
      await writeFile(overlayPath, overlayText.replace(pureLine, "return this.run(options, async () => this.listing(await this.required(path, options), options));"));
      await failure(await save("negative-restored-cleanup-v5", await run(process.execPath, [join(taskRoot, "harness", "verify-v5.mjs"), mutantPackage, scratch], { cwd: mutantConsumer })), "restored cleanup behavior mutant");
    } finally {
      await removeOwnedCopy(mutantConsumer, "restored-cleanup mutant copy");
    }

    const typeConsumer = join(scratch, "negative-semantic-declaration");
    let badTypes;
    try {
      await guardedCopy(movedConsumer, typeConsumer, "semantic-declaration-consumer");
      const declaration = join(typeConsumer, "node_modules", "virtual-bash", "dist", "commands", "du", "index.d.ts");
      await writeFile(declaration, `${await readFile(declaration, "utf8")}\nexport declare const __v5SemanticDeclarationControl: __V5MissingDeclaredType;\n`);
      badTypes = await failure(await save("negative-semantic-declaration", await run(tsc, ["-p", join(typeConsumer, "tsconfig.json")], { cwd: typeConsumer })), "semantic undeclared-type control");
      if (!/Cannot find name '__V5MissingDeclaredType'|TS2304/u.test(badTypes.stdout.toString() + badTypes.stderr.toString())) throw new Error("declaration control failed for an unexpected reason");
    } finally {
      await removeOwnedCopy(typeConsumer, "semantic-declaration mutant copy");
    }

    const nativeOutput = join(evidence, "native-environment-table.json");
    await save("native-environment-table", await success(await run(process.execPath, [join(taskRoot, "native-env.mjs"), nativeDu, nativeOutput, join(scratch, "native")]), "native environment table"));

    const inputsAfter = await inventory(source, new Set(["dist"]));
    if (JSON.stringify(inputsBefore) !== JSON.stringify(inputsAfter)) throw new Error("candidate selected inputs changed or gained entries outside dist");
    await writeFile(join(evidence, "candidate-inputs-after.json"), json(inputsAfter), { flag: "wx" });
    materializedAfterCases = await verifyMaterializedTree(freeze, "materialized-after-cases-before-cleanup");
    await writeFile(join(evidence, "materialized-after-cases.json"), json(materializedAfterCases), { flag: "wx" });
    const indexAfter = await success(await run("git", ["diff", "--cached", "--binary"]), "foreign index after");
    resultManifest = {
      schema: 2,
      startedAt,
      finishedAt: new Date().toISOString(),
      invocation: { argv: process.argv, cwd: process.cwd() },
      freezeCommit,
      candidate,
      frozenManifestSha256: sha256(freeze.bytes),
      tools: toolIdentities,
      candidateArchive: { selectedFileCount: selected.length, sha256: sha256(await readFile(archive)), preArchiveAdmission: true, preExtractionAdmission: true, appendCheckedAfterRun: true },
      npmPackage: {
        tarballSha256,
        completeFileCount: packedInventory.length,
        completeInstalledHashesMatch: true,
        dryRunBeforeArchive: true,
        dryRunCreatedArchiveCount: 0,
        preArchivePacklistAdmission: admittedPackPlan,
        actualTarMatchesAdmittedListBeforeExtraction: true,
        extractedBytesMatchAdmittedInputs: true,
        dependencyArchiveAdmission,
        productionDependencies: productPackage.dependencies ?? {},
        productionDependencyCount: 0,
      },
      suites: { originalSource: sourceOriginalJson.summary, originalMoved: packageRuns.original.summary, v5Source: sourceV5Json.summary, v5Moved: packageRuns.v5.summary, sameSourceAndMovedProjections: true },
      scopedRegressions: { exactFiles: regressionFiles, status: 0, unrelatedAuthorCohortsNotSummed: true },
      negativeControls: {
        wrongRoot: wrongRoot.status,
        missingDu: "failed-as-required",
        restoredCleanup: "failed-unchanged-assertions",
        semanticDeclaration: badTypes.status,
        agentsAdmission: executableNegativeAdmissionControl(),
        invalidPacklist: executableInvalidPacklistControl(),
        timeoutGrandchild: { timedOut: true, ownedGroupGone: true, grandchildPidGone: true },
      },
      native: { scope: "single-file apparent-size environment precedence only", broadParityClaimed: false, output: "native-environment-table.json" },
      indexFingerprint: { before: indexBeforeSha256, after: sha256(indexAfter.stdout), unchanged: indexBeforeSha256 === sha256(indexAfter.stdout) },
      frozenInputs: { before: materializedBefore, afterCasesBeforeCleanup: materializedAfterCases },
      mutantCopyCleanup,
      closure: { workersOrSubagentsCreated: 0, scratchUnderOwnedResult: scratch.startsWith(`${resultDirectory}/work-`) },
      steps,
    };
    if (!resultManifest.indexFingerprint.unchanged) throw new Error("foreign index fingerprint changed");
  } catch (error) {
    protocolError = error;
  } finally {
    await processManager.shutdown(protocolError ? "materialized-failure" : "materialized-cases-complete");
    if (processManager.interruptedBy && !protocolError) protocolError = new Error(`materialized replay interrupted by ${processManager.interruptedBy}`);
    let postcheckError;
    try {
      const postcheckFreeze = freeze ?? await (async () => {
        const bytes = await readFile(join(taskRoot, "MANIFEST.json"));
        return { manifest: JSON.parse(bytes.toString()), bytes, manifestBlob: gitBlob(bytes) };
      })();
      materializedAfterCases = await verifyMaterializedTree(postcheckFreeze, "materialized-finally-before-cleanup");
      await writeFile(join(evidence, "materialized-finally-before-cleanup.json"), json(materializedAfterCases), { flag: "wx" });
    } catch (error) {
      postcheckError = error;
      protocolError ??= error;
    }
    let closure;
    try {
      closure = processManager.assertClosed();
      await writeProcessHistory(evidence, "all-processes-raw");
    } catch (error) {
      protocolError ??= error;
    }
    if (!protocolError) {
      try {
        await rm(scratch, { recursive: true, force: true });
        let scratchExists = true;
        try { await stat(scratch); }
        catch (error) { if (error.code === "ENOENT") scratchExists = false; else throw error; }
        if (scratchExists) throw new Error("owned scratch remained after cleanup");
        scratchRemoved = true;
        materializedAfterCleanup = await verifyMaterializedTree(freeze, "materialized-after-cleanup");
        resultManifest.finishedAt = new Date().toISOString();
        resultManifest.frozenInputs.finallyBeforeCleanup = materializedAfterCases;
        resultManifest.frozenInputs.afterCleanup = materializedAfterCleanup;
        resultManifest.closure = { ...resultManifest.closure, ...closure };
        await writeFile(join(evidence, "RESULTS.json"), json(resultManifest), { flag: "wx" });
        await writeFile(join(evidence, "SCRATCH-CLOSED.json"), json({
          removed: true,
          path: scratch,
          actualPostCleanupStat: "ENOENT",
          materializedAfterCleanup,
          processClosure: closure,
        }), { flag: "wx" });
        process.stdout.write(`${evidence}\n`);
      } catch (error) {
        protocolError = error;
      }
    }
    if (protocolError) {
      await writeFile(join(evidence, "PROTOCOL-ERROR.txt"), `${protocolError.stack ?? protocolError}\n`, { flag: "wx" });
      await writeFile(join(evidence, "FAILED-CLOSURE.json"), json({
        at: new Date().toISOString(),
        processClosure: closure,
        frozenPostcheckError: postcheckError ? `${postcheckError.stack ?? postcheckError}` : undefined,
        materializedFinallyBeforeCleanup: materializedAfterCases,
        scratchRetained: scratchRemoved ? undefined : scratch,
        scratchRemoved,
      }), { flag: "wx" });
      process.stderr.write(`${protocolError.stack ?? protocolError}\nFailed evidence retained at ${evidence}\n`);
    }
  }
  if (protocolError) process.exitCode = 1;
}

try {
  if (materialized) await executeMaterialized();
  else await executeBootstrap();
} finally {
  await processManager.shutdown("top-level-finally");
  processManager.removeSignalHandlers();
}
