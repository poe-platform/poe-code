import { createHash } from "node:crypto";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const gitBlob = bytes => createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
const manifestBytes = await readFile(join(root, "EVIDENCE_MANIFEST.json"));
const manifest = JSON.parse(manifestBytes.toString());
if (manifest.selfExcluded !== true || manifest.pathOrder !== "ASCII bytewise") {
  throw new Error("manifest self-exclusion or ordering contract is absent");
}

const actual = [];
const visit = async directory => {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const local = relative(root, path).replaceAll("\\", "/");
    if (local === "EVIDENCE_MANIFEST.json") continue;
    if (/(^|\/)AGENTS\.md$/u.test(local)) throw new Error(`forbidden evidence path: ${local}`);
    if (entry.isDirectory()) await visit(path);
    else if (entry.isFile()) {
      const bytes = await readFile(path);
      actual.push({
        path: local,
        bytes: bytes.byteLength,
        mode: (await lstat(path)).mode & 0o7777,
        sha256: sha256(bytes),
        gitBlob: gitBlob(bytes),
      });
    } else throw new Error(`unsupported evidence entry: ${local}`);
  }
};
await visit(root);
actual.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) {
  throw new Error("complete evidence inventory differs from self-excluded manifest");
}

const runRoot = join(root, manifest.run.relativePath);
const failure = JSON.parse(await readFile(join(runRoot, "FAILURE_ANALYSIS.json"), "utf8"));
if (failure.decision !== manifest.decision
  || failure.sourceOriginal.summary.total !== 24 || failure.sourceOriginal.summary.passed !== 24
  || failure.sourceFresh.summary.total !== 40 || failure.sourceFresh.summary.passed !== 38
  || failure.sourceFresh.failedCases.map(result => result.id).join(",") !== "V5-023,V5-024"
  || failure.metadataDu.passed !== 19 || failure.metadataDu.authorizedDirectoryAtimeDeltas !== 19
  || failure.metadataDu.unauthorizedDeltas !== 0) {
  throw new Error("sealed failure decision or counts differ");
}
if (failure.processClosure.totalRootRecords !== 113
  || failure.processClosure.totalGroupRecords !== 113
  || failure.processClosure.liveRootPids.length || failure.processClosure.liveProcessGroups.length
  || failure.processClosure.timeoutGrandchildAlive) {
  throw new Error("sealed process closure differs");
}

let rawRecordCount = 0;
for (const directory of [join(runRoot, "all-processes-raw"), join(root, "replay-001", "bootstrap-processes")]) {
  const index = JSON.parse(await readFile(join(directory, "INDEX.json"), "utf8"));
  for (const record of index.records) {
    const stem = String(record.sequence).padStart(3, "0");
    const stdout = await readFile(join(directory, `${stem}.stdout`));
    const stderr = await readFile(join(directory, `${stem}.stderr`));
    if (sha256(stdout) !== record.stdoutSha256 || sha256(stderr) !== record.stderrSha256
      || record.closure.rootPidGone !== true || record.closure.groupGone !== true) {
      throw new Error(`raw process record differs: ${relative(root, directory)}/${stem}`);
    }
    rawRecordCount++;
  }
}
if (rawRecordCount !== 113) throw new Error("raw process record count differs");

const scratchClosed = JSON.parse(await readFile(join(runRoot, "SCRATCH-CLOSED.json"), "utf8"));
for (const basename of [scratchClosed.workScratch.basename, scratchClosed.bootstrapScratch.basename]) {
  try {
    await stat(join(root, "replay-001", basename));
    throw new Error(`owned scratch unexpectedly exists: ${basename}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

process.stdout.write(`${JSON.stringify({
  candidateCommit: manifest.candidateCommit,
  freezeCommit: manifest.freezeCommit,
  evidenceBaseCommit: manifest.evidenceBaseCommit,
  manifestSha256: sha256(manifestBytes),
  manifestGitBlob: gitBlob(manifestBytes),
  nonSelfFileCount: manifest.files.length,
  allBytesModesShaAndGitBlobsVerified: true,
  rawProcessRecordsVerified: rawRecordCount,
  decision: manifest.decision,
  scratch: "ENOENT",
  forbiddenAgents: 0,
}, null, 2)}\n`);
