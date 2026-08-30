import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../../../..");
const revisions = {
  baseline: "877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3",
  parent: "31f5678e62e3f3d43b4825d839ec970e7768da7d",
  candidate: "9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d",
};
const incidentCommit = "2dd6d631f1862487b0874e03f07301769c3a4271";
const authorCombinedEvidence = "c5fe1a68341b3a2ebbefd9fee6793a1e6c5df10b";
const oldAuditPath = "tests/integration/du-overlay-independent-20260827/migration-audit-9a5a6f92/audit.mjs";
const oldResultsPath = "tests/integration/du-overlay-independent-20260827/migration-audit-9a5a6f92/RESULTS.json";
const selectedRoots = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "src",
  "tests/commands/du/behavior.test.ts",
  "tests/commands/du/native.test.ts",
  "tests/commands/du/helpers.ts",
  "tests/commands/du/native-profile.json",
];
const prohibitedBasename = "AGENTS.md";
const behaviorPatterns = {
  baseline: "^all argument and environment validation happens before any filesystem call$",
  parent: "^all argument and environment validation happens before any filesystem call$",
  candidate: "^invalid arguments fail before filesystem calls; selected invalid environment falls back$",
};
const nativePattern = "^GNU 9\\.7 captured profile: (-b |env:\\{\\\"DU_BLOCK_SIZE\\\":(\\\"bad\\\"|\\\"\\\",\\\"BLOCK_SIZE\\\":\\\"2K\\\")\\\})$";
const expectedTotals = {
  baseline: { pass: 4, fail: 0 },
  parent: { pass: 0, fail: 4 },
  candidate: { pass: 4, fail: 0 },
};
const activeChildren = new Set();
const counters = { filesystemWrites: 0, archiveCreations: 0, extractionAttempts: 0 };

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const sha1 = bytes => createHash("sha1").update(bytes).digest("hex");
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function gitBlobId(bytes) {
  return sha1(Buffer.concat([Buffer.from(`blob ${bytes.byteLength}\0`), bytes]));
}

async function run(program, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(program, args, {
      cwd: options.cwd ?? repository,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChildren.add(child.pid);
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
    child.on("error", rejectPromise);
    child.on("close", (status, signal) => {
      activeChildren.delete(child.pid);
      resolvePromise({ program, args, cwd: options.cwd ?? repository, status, signal,
        stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

function requireSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}, ${result.signal}): ${result.stderr.toString("utf8")}`);
  }
  return result;
}

async function trackedWrite(path, bytes) {
  counters.filesystemWrites += 1;
  await writeFile(path, bytes);
}

function safeRelativePath(path) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0") || path.includes("\\")) return false;
  if (path.startsWith("/") || path.endsWith("/")) return false;
  const parts = path.split("/");
  return parts.every(part => part !== "" && part !== "." && part !== "..");
}

function admitInventory(entries, label) {
  const paths = new Set();
  for (const entry of entries) {
    if (!safeRelativePath(entry.path)) throw new Error(`${label}: unsafe path rejected: ${JSON.stringify(entry.path)}`);
    if (basename(entry.path) === prohibitedBasename) {
      throw new Error(`${label}: prohibited basename rejected before archive or write: ${entry.path}`);
    }
    if (paths.has(entry.path)) throw new Error(`${label}: duplicate path rejected: ${entry.path}`);
    paths.add(entry.path);
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) {
      throw new Error(`${label}: non-regular entry rejected: ${entry.mode} ${entry.type} ${entry.path}`);
    }
  }
  if (entries.length === 0) throw new Error(`${label}: empty inventory rejected`);
  return entries;
}

function parseGitTree(bytes, label) {
  const entries = bytes.toString("utf8").split("\0").filter(Boolean).map(record => {
    const match = record.match(/^(\d+) (\S+) ([0-9a-f]{40})\t([\s\S]+)$/u);
    if (!match) throw new Error(`${label}: unparseable Git tree record`);
    return { mode: match[1], type: match[2], object: match[3], path: match[4] };
  });
  return admitInventory(entries, label);
}

function readTarString(block, start, length) {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function readTarOctal(block, start, length) {
  const text = readTarString(block, start, length).trim();
  if (!/^[0-7]*$/u.test(text)) throw new Error(`invalid tar octal field: ${JSON.stringify(text)}`);
  return text === "" ? 0 : Number.parseInt(text, 8);
}

function tarChecksum(block) {
  let sum = 0;
  for (let index = 0; index < 512; index += 1) sum += index >= 148 && index < 156 ? 32 : block[index];
  return sum;
}

function parseTar(bytes) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) break;
    const storedChecksum = readTarOctal(header, 148, 8);
    if (storedChecksum !== tarChecksum(header)) throw new Error(`tar checksum mismatch at byte ${offset}`);
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const size = readTarOctal(header, 124, 12);
    const typeByte = header[156];
    const type = typeByte === 0 ? "0" : String.fromCharCode(typeByte);
    const payloadStart = offset + 512;
    const payloadEnd = payloadStart + size;
    if (payloadEnd > bytes.byteLength) throw new Error(`truncated tar payload for ${path}`);
    const payload = bytes.subarray(payloadStart, payloadEnd);
    entries.push({ path, type, size, payloadSha256: sha256(payload) });
    offset = payloadStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function expectedDirectories(paths) {
  const directories = new Set();
  for (const path of paths) {
    const parts = path.split("/");
    for (let count = 1; count < parts.length; count += 1) directories.add(parts.slice(0, count).join("/"));
  }
  return directories;
}

function admitTar(entries, allowedEntries, label) {
  const allowedFiles = new Map(allowedEntries.map(entry => [entry.path, entry]));
  const allowedDirectories = expectedDirectories(allowedFiles.keys());
  const seenFiles = new Set();
  for (const entry of entries) {
    if (entry.type === "g" && entry.path === "pax_global_header") continue;
    const normalized = entry.type === "5" && entry.path.endsWith("/") ? entry.path.slice(0, -1) : entry.path;
    if (!safeRelativePath(normalized)) throw new Error(`${label}: unsafe tar path rejected: ${entry.path}`);
    if (basename(normalized) === prohibitedBasename) throw new Error(`${label}: prohibited tar entry rejected: ${entry.path}`);
    if (entry.type === "5") {
      if (!allowedDirectories.has(normalized)) throw new Error(`${label}: unexpected directory entry: ${entry.path}`);
      continue;
    }
    if (entry.type !== "0") throw new Error(`${label}: link or special tar entry rejected: ${entry.type} ${entry.path}`);
    const expected = allowedFiles.get(normalized);
    if (!expected) throw new Error(`${label}: unexpected regular entry: ${entry.path}`);
    if (seenFiles.has(normalized)) throw new Error(`${label}: duplicate regular entry: ${entry.path}`);
    seenFiles.add(normalized);
  }
  const missing = [...allowedFiles.keys()].filter(path => !seenFiles.has(path));
  if (missing.length > 0) throw new Error(`${label}: missing tar entries: ${missing.join(", ")}`);
}

async function treeFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`symlink found in authenticated scratch: ${path}`);
      if (stat.isDirectory()) await visit(absolute);
      else if (stat.isFile()) files.push({ absolute, path, stat });
      else throw new Error(`special entry found in authenticated scratch: ${path}`);
    }
  }
  await visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function extractedManifest(root, allowedEntries) {
  const expected = new Map(allowedEntries.map(entry => [entry.path, entry]));
  const files = await treeFiles(root);
  const actualPaths = files.map(item => item.path);
  const missing = [...expected.keys()].filter(path => !actualPaths.includes(path));
  const extra = actualPaths.filter(path => !expected.has(path));
  if (missing.length || extra.length) throw new Error(`extracted inventory mismatch; missing=${missing.join(",")}; extra=${extra.join(",")}`);
  const manifest = [];
  for (const item of files) {
    const bytes = await readFile(item.absolute);
    const mode = item.stat.mode & 0o111 ? "100755" : "100644";
    const record = { path: item.path, mode, type: "blob", object: gitBlobId(bytes), bytes: bytes.byteLength, sha256: sha256(bytes) };
    const wanted = expected.get(item.path);
    if (record.mode !== wanted.mode || record.object !== wanted.object) {
      throw new Error(`extracted mode/blob mismatch: ${item.path}`);
    }
    manifest.push(record);
  }
  return manifest;
}

async function currentProhibitedFiles() {
  const listed = requireSuccess(await run("git", ["ls-files", "-z"]), "list tracked paths").stdout
    .toString("utf8").split("\0").filter(path => basename(path) === prohibitedBasename);
  const records = [];
  for (const path of listed) {
    const bytes = await readFile(join(repository, path));
    records.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  return records;
}

function parseTapSummary(stdout) {
  const text = stdout.toString("utf8");
  const value = name => {
    const match = text.match(new RegExp(`^# ${name} (\\d+)$`, "mu"));
    if (!match) throw new Error(`missing TAP ${name} summary`);
    return Number(match[1]);
  };
  return { tests: value("tests"), pass: value("pass"), fail: value("fail"), skipped: value("skipped") };
}

async function saveRun(runDirectory, name, result) {
  await trackedWrite(join(runDirectory, `${name}.stdout.txt`), result.stdout);
  await trackedWrite(join(runDirectory, `${name}.stderr.txt`), result.stderr);
  const record = {
    program: result.program,
    args: result.args,
    cwd: result.cwd,
    status: result.status,
    signal: result.signal,
    stdoutBytes: result.stdout.byteLength,
    stderrBytes: result.stderr.byteLength,
    stdoutSha256: sha256(result.stdout),
    stderrSha256: sha256(result.stderr),
    tap: parseTapSummary(result.stdout),
  };
  await trackedWrite(join(runDirectory, `${name}.command.json`), json(record));
  return record;
}

async function gitObject(commit) {
  const output = requireSuccess(await run("git", ["show", "-s", "--format=%H%n%P%n%T%n%aI%n%s", commit]), `show ${commit}`)
    .stdout.toString("utf8").trimEnd().split("\n");
  return { commit: output[0], parents: output[1].split(" ").filter(Boolean), tree: output[2], authoredAt: output[3], subject: output.slice(4).join("\n") };
}

async function gitArtifact(commit, path) {
  const tree = requireSuccess(await run("git", ["ls-tree", commit, "--", path]), `ls-tree ${commit}:${path}`)
    .stdout.toString("utf8").trim();
  const match = tree.match(/^(\d+) blob ([0-9a-f]{40})\t/u);
  if (!match) throw new Error(`not a blob: ${commit}:${path}`);
  const bytes = requireSuccess(await run("git", ["show", `${commit}:${path}`]), `show ${commit}:${path}`).stdout;
  return { commit, path, mode: match[1], gitBlob: match[2], bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function revisionProhibitedInventory(commit) {
  const output = requireSuccess(await run("git", ["ls-tree", "-r", "--name-only", "-z", commit]), `list ${commit}`).stdout;
  return output.toString("utf8").split("\0").filter(path => basename(path) === prohibitedBasename);
}

async function exists(path) {
  try { await access(path); return true; } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function removeAuthenticatedTree(path, authenticatedParent) {
  const parentReal = await realpath(authenticatedParent);
  const pathReal = await realpath(path);
  if (!pathReal.startsWith(`${parentReal}${sep}`)) throw new Error(`cleanup target escaped authenticated parent: ${pathReal}`);
  async function remove(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const stat = await lstat(absolute);
      if (stat.isDirectory() && !stat.isSymbolicLink()) await remove(absolute);
      else await unlink(absolute);
    }
    await rmdir(directory);
  }
  await remove(pathReal);
}

const negativeStart = { ...counters };
let negativeMessage = "";
try {
  admitInventory([{ path: "synthetic/AGENTS.md", mode: "100644", type: "blob", object: "0".repeat(40) }], "negative control");
  throw new Error("negative control unexpectedly admitted prohibited inventory");
} catch (error) {
  negativeMessage = error.message;
}
const negativeControl = {
  executable: true,
  admitted: false,
  syntheticOnly: true,
  createdProhibitedFile: false,
  message: negativeMessage,
  countersBefore: negativeStart,
  countersAfter: { ...counters },
};
if (!negativeMessage.includes("prohibited basename rejected") || JSON.stringify(negativeStart) !== JSON.stringify(counters)) {
  throw new Error("pre-write negative admission control did not prove rejection");
}

const resolvedRoot = await realpath(repository);
const gitRoot = requireSuccess(await run("git", ["rev-parse", "--show-toplevel"]), "resolve Git root").stdout.toString("utf8").trim();
if (resolvedRoot !== await realpath(gitRoot)) throw new Error("wrong Git repository root");

const prohibitedBefore = await currentProhibitedFiles();
const gitInventories = {};
for (const [label, revision] of Object.entries(revisions)) {
  const resolved = requireSuccess(await run("git", ["rev-parse", `${revision}^{commit}`]), `resolve ${label}`).stdout.toString("utf8").trim();
  if (resolved !== revision) throw new Error(`${label} revision resolution changed`);
  const listed = requireSuccess(await run("git", ["ls-tree", "-rz", revision, "--", ...selectedRoots]), `select ${label}`);
  gitInventories[label] = parseGitTree(listed.stdout, `${label} pre-archive inventory`);
}
const referencePaths = gitInventories.candidate.map(entry => entry.path);
for (const [label, entries] of Object.entries(gitInventories)) {
  if (JSON.stringify(entries.map(entry => entry.path)) !== JSON.stringify(referencePaths)) {
    throw new Error(`${label} selected path set differs from candidate`);
  }
}
if (referencePaths.length !== 245) throw new Error(`selected path count changed: ${referencePaths.length}`);
process.stdout.write(`pre-extraction admission validated: ${referencePaths.length} selected paths, zero prohibited paths, negative control rejected before writes\n`);

const startedAt = new Date().toISOString();
const runId = `run-${startedAt.replaceAll(":", "").replaceAll(".", "")}-${randomBytes(4).toString("hex")}`;
const evidenceParent = join(owned, "evidence");
const scratchParent = join(owned, ".scratch");
const evidence = join(evidenceParent, runId);
const scratch = join(scratchParent, runId);
await mkdir(evidenceParent, { recursive: true });
await mkdir(scratchParent, { recursive: true });
await mkdir(evidence);
await mkdir(scratch);
counters.filesystemWrites += 4;

let completed;
let failure;
try {
  await trackedWrite(join(evidence, "prewrite-admission.json"), json({
    negativeControl,
    actualInventoriesAdmittedBeforeArchive: true,
    selectedPathCount: referencePaths.length,
    prohibitedSelectedPaths: referencePaths.filter(path => basename(path) === prohibitedBasename),
    filesystemWritesBeforeAdmissionCompleted: 0,
    archiveCreationsBeforeAdmissionCompleted: 0,
    extractionAttemptsBeforeAdmissionCompleted: 0,
  }));
  await trackedWrite(join(evidence, "selected-paths.txt"), `${referencePaths.join("\n")}\n`);

  const snapshots = {};
  const tsxLoader = resolve(repository, "node_modules/tsx/dist/loader.mjs");
  const importArgument = pathToFileURL(tsxLoader).href;
  for (const [label, revision] of Object.entries(revisions)) {
    const snapshotScratch = join(scratch, label);
    const archivePath = join(snapshotScratch, `${label}-selected.tar`);
    const extracted = join(snapshotScratch, "extracted");
    const snapshotEvidence = join(evidence, label);
    await mkdir(snapshotScratch);
    await mkdir(extracted);
    await mkdir(snapshotEvidence);
    counters.filesystemWrites += 3;

    counters.archiveCreations += 1;
    const archiveCommand = requireSuccess(await run("git", ["archive", "--format=tar", `--output=${archivePath}`, revision, "--", ...referencePaths]), `archive ${label}`);
    const archiveBytes = await readFile(archivePath);
    const tarEntries = parseTar(archiveBytes);
    admitTar(tarEntries, gitInventories[label], `${label} archive admission`);
    await trackedWrite(join(snapshotEvidence, "archive-command.json"), json({
      program: archiveCommand.program,
      args: archiveCommand.args,
      cwd: archiveCommand.cwd,
      status: archiveCommand.status,
      signal: archiveCommand.signal,
      stdoutSha256: sha256(archiveCommand.stdout),
      stderrSha256: sha256(archiveCommand.stderr),
    }));
    await trackedWrite(join(snapshotEvidence, "archive-inventory.json"), json(tarEntries));
    await trackedWrite(join(snapshotEvidence, "archive-sha256.txt"), `${sha256(archiveBytes)}\n`);

    counters.extractionAttempts += 1;
    const extraction = requireSuccess(await run("tar", ["-xf", archivePath, "-C", extracted]), `extract ${label}`);
    await trackedWrite(join(snapshotEvidence, "extraction-command.json"), json({
      program: extraction.program,
      args: extraction.args,
      cwd: extraction.cwd,
      status: extraction.status,
      signal: extraction.signal,
      stdoutSha256: sha256(extraction.stdout),
      stderrSha256: sha256(extraction.stderr),
      archiveAdmissionCompletedBeforeAttempt: true,
    }));
    const before = await extractedManifest(extracted, gitInventories[label]);
    await trackedWrite(join(snapshotEvidence, "selected-manifest-before.json"), json(before));

    const behavior = await run(process.execPath, ["--import", importArgument, "--test", `--test-name-pattern=${behaviorPatterns[label]}`, "tests/commands/du/behavior.test.ts"], { cwd: extracted });
    const native = await run(process.execPath, ["--import", importArgument, "--test", `--test-name-pattern=${nativePattern}`, "tests/commands/du/native.test.ts"], { cwd: extracted });
    const behaviorRecord = await saveRun(snapshotEvidence, "behavior", behavior);
    const nativeRecord = await saveRun(snapshotEvidence, "native", native);
    const totals = {
      pass: behaviorRecord.tap.pass + nativeRecord.tap.pass,
      fail: behaviorRecord.tap.fail + nativeRecord.tap.fail,
      selected: behaviorRecord.tap.pass + behaviorRecord.tap.fail + nativeRecord.tap.pass + nativeRecord.tap.fail,
    };
    if (totals.selected !== 4 || JSON.stringify({ pass: totals.pass, fail: totals.fail }) !== JSON.stringify(expectedTotals[label])) {
      throw new Error(`${label} exact-four result changed: ${JSON.stringify(totals)}`);
    }
    const after = await extractedManifest(extracted, gitInventories[label]);
    await trackedWrite(join(snapshotEvidence, "selected-manifest-after.json"), json(after));
    const beforeHash = sha256(Buffer.from(json(before)));
    const afterHash = sha256(Buffer.from(json(after)));
    if (beforeHash !== afterHash) throw new Error(`${label} selected input manifest changed during execution`);
    snapshots[label] = {
      revision,
      selectedPathCount: before.length,
      archiveSha256: sha256(archiveBytes),
      archiveEntryCount: tarEntries.length,
      manifestBeforeSha256: beforeHash,
      manifestAfterSha256: afterHash,
      unchanged: true,
      runs: { behavior: behaviorRecord, native: nativeRecord },
      totals,
    };
    process.stdout.write(`${label} exact-four rerun: ${totals.pass} pass, ${totals.fail} fail\n`);
  }

  const prohibitedDuring = [];
  for (const root of [scratch, evidence]) {
    for (const item of await treeFiles(root)) if (basename(item.path) === prohibitedBasename) prohibitedDuring.push(item.path);
  }
  if (prohibitedDuring.length > 0) throw new Error(`prohibited copies found in owned capture: ${prohibitedDuring.join(", ")}`);
  const prohibitedAfter = await currentProhibitedFiles();
  if (JSON.stringify(prohibitedBefore) !== JSON.stringify(prohibitedAfter)) throw new Error("real repository prohibited-file hashes changed");

  const revisionMetadata = {};
  const incidentInventories = {};
  for (const [label, revision] of Object.entries(revisions)) {
    revisionMetadata[label] = await gitObject(revision);
    incidentInventories[label] = await revisionProhibitedInventory(revision);
  }
  const tools = {
    node: { version: process.version, executable: process.execPath, executableSha256: sha256(await readFile(process.execPath)) },
    tsxLoader: { path: tsxLoader, sha256: sha256(await readFile(tsxLoader)) },
    tsxPackage: { path: resolve(repository, "node_modules/tsx/package.json"), sha256: sha256(await readFile(resolve(repository, "node_modules/tsx/package.json"))) },
    packageLock: await gitArtifact(revisions.candidate, "package-lock.json"),
    gitVersion: requireSuccess(await run("git", ["--version"]), "git version").stdout.toString("utf8").trim(),
    tarVersion: requireSuccess(await run("tar", ["--version"]), "tar version").stdout.toString("utf8").trim(),
  };
  const nativeProvenance = {
    rerun: false,
    reason: "bounded protocol correction reuses authenticated immutable GNU 9.7 corroboration and does not duplicate the native audit",
    oldResults: await gitArtifact(incidentCommit, oldResultsPath),
    authorCombinedEvidence: await gitObject(authorCombinedEvidence),
    oracleBinarySha256BeforeAfter: "f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b",
    oracleSourceSha256: "3cd1c0120881ba28da3345b1324e9d146f948a95db6ce2900ba27b3fe8f45bf9",
    corroboratedCases: ["O062", "O086", "O087", "scope-BLOCK_SIZE-invalid", "scope-BLOCKSIZE-invalid"],
    platformQualification: "Darwin GNU coreutils 9.7 observation; not GNU/Linux or universal parity",
  };
  const incident = {
    acknowledged: true,
    copiesCreatedThenRemoved: 15,
    perTreeCount: 5,
    oldScratchRandomSuffixRecorded: false,
    oldCleanupResult: { artifact: `${incidentCommit}:${oldResultsPath}`, line: 499, text: "scratchCleanup: performed in finally after results write; paths are not retained" },
    unsafeCode: { artifact: `${incidentCommit}:${oldAuditPath}`, archiveAndExtractLines: "82-90", invocationLines: "131-135", cleanupLines: "229-230" },
    oldAudit: await gitArtifact(incidentCommit, oldAuditPath),
    trees: incidentInventories,
    realRepositoryFilesModifiedByIncident: false,
    disclosure: "root already disclosed the violation to the user; this rerun does not undo or minimize it",
    oldHarnessStatus: "use prohibited; retained unchanged as incident evidence",
  };
  completed = {
    schemaVersion: 2,
    startedAt,
    completedAt: new Date().toISOString(),
    runId,
    scope: "only the exact four canonical DU expectation migrations; no whole gate, package suite, product repair, or native rerun",
    revisions: revisionMetadata,
    selection: { roots: selectedRoots, fullManifest: "selected-paths.txt", count: referencePaths.length },
    guard: { negativeControl, archiveInventoryInspectedBeforeEveryExtraction: true, prohibitedCopiesFound: 0, symlinkOrSpecialEntriesAdmitted: 0 },
    incident,
    snapshots,
    tools,
    nativeProvenance,
    openPolicyQuestion: "32c5b60c3323101ebd3d4a3339931caa93867ae5 also applies fallback to invalid/empty selected BLOCK_SIZE and BLOCKSIZE; native behavior is corroborated, but root authorization remains explicit only for invalid selected DU_BLOCK_SIZE and ambiguous for empty/lower-priority selected values.",
    retainedLimits: { nativeOrderingDifferences: 3, O060Implemented: false, rootWiringChanged: false },
    repositoryProhibitedFiles: { before: prohibitedBefore, after: prohibitedAfter, unchanged: true },
    counters: { ...counters },
  };
} catch (error) {
  failure = { failedAt: new Date().toISOString(), message: error.message, stack: error.stack, activeChildren: [...activeChildren], counters: { ...counters } };
} finally {
  if (activeChildren.size > 0 && !failure) failure = { failedAt: new Date().toISOString(), message: "active child processes remained", activeChildren: [...activeChildren] };
  if (await exists(scratch)) await removeAuthenticatedTree(scratch, scratchParent);
  if (failure) {
    await trackedWrite(join(evidence, "FAILED.json"), json({ ...failure, scratchRemoved: !await exists(scratch), activeChildrenAfterCleanup: [...activeChildren] }));
  }
}

if (failure) throw new Error(`capture failed; retained evidence at ${evidence}: ${failure.message}`);
completed.closure = { allChildrenAwaited: activeChildren.size === 0, activeChildren: [...activeChildren], scratchRemoved: !await exists(scratch), cleanupMethod: "authenticated exact recursive unlink/rmdir; no broad shell removal" };
await trackedWrite(join(evidence, "RESULTS.json"), json(completed));
process.stdout.write(`${evidence}\n`);
