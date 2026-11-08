import { createHash } from "node:crypto";
import {
  lstat, readFile, readdir, readlink, realpath, rm, stat, writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

const replayRoot = await realpath(resolve(process.argv[2] ?? ""));
const runRoot = await realpath(resolve(process.argv[3] ?? ""));
if (!process.argv[2] || !process.argv[3] || dirname(runRoot) !== replayRoot) {
  throw new Error("usage: node seal-failed-replay.mjs REPLAY_ROOT DIRECT_RUN_ROOT");
}

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => `${JSON.stringify(value, null, 2)}\n`;

async function inventory(root, excludedTopLevel = new Set()) {
  const files = [];
  const directories = [];
  const links = [];
  const visit = async absolute => {
    const entries = await readdir(absolute, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const absolutePath = join(absolute, entry.name);
      const path = relative(root, absolutePath).replaceAll("\\", "/");
      if (!path.includes("/") && excludedTopLevel.has(path)) continue;
      if (entry.isDirectory()) {
        directories.push(path);
        await visit(absolutePath);
      } else if (entry.isFile()) {
        const bytes = await readFile(absolutePath);
        const mode = (await lstat(absolutePath)).mode & 0o7777;
        files.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes), mode });
      } else if (entry.isSymbolicLink()) {
        links.push({ path, target: await readlink(absolutePath) });
      } else {
        throw new Error(`unsupported retained entry: ${path}`);
      }
    }
  };
  await visit(root);
  return {
    root,
    fileCount: files.length,
    directoryCount: directories.length,
    symlinkCount: links.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
    directories,
    links,
    fileInventorySha256: sha256(Buffer.from(json(files))),
    completeEntryInventorySha256: sha256(Buffer.from(json({ directories, files, links }))),
  };
}

function processTargetExists(target) {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function absent(path) {
  try {
    await stat(path);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

const failedClosure = JSON.parse(await readFile(join(runRoot, "FAILED-CLOSURE.json"), "utf8"));
const bootstrapClosure = JSON.parse(await readFile(join(replayRoot, "BOOTSTRAP-PROCESS-CLOSURE.json"), "utf8"));
const scratchRoot = await realpath(failedClosure.scratchRetained);
const bootstrapScratch = await realpath(bootstrapClosure.retainedScratch);
if (dirname(scratchRoot) !== replayRoot || !basename(scratchRoot).startsWith("work-")) {
  throw new Error(`refusing non-direct work scratch: ${scratchRoot}`);
}
if (bootstrapScratch !== join(replayRoot, "bootstrap-scratch")) {
  throw new Error(`refusing unexpected bootstrap scratch: ${bootstrapScratch}`);
}

const scratch = await inventory(scratchRoot);
const bootstrap = await inventory(bootstrapScratch);
const sourceRoot = join(scratchRoot, "source");
const source = await inventory(sourceRoot);
const sourceInputsAfter = await inventory(sourceRoot, new Set(["dist"]));
const dist = await inventory(join(sourceRoot, "dist"));
const sourceInputsBefore = JSON.parse(await readFile(join(runRoot, "candidate-inputs-before.json"), "utf8"));
const sourceInputsAfterProjection = sourceInputsAfter.files.map(({ path, bytes, sha256: hash }) => ({
  path, bytes, sha256: hash,
}));
const sourceInputsUnchanged = JSON.stringify(sourceInputsAfterProjection) === JSON.stringify(sourceInputsBefore);
if (!sourceInputsUnchanged) throw new Error("retained candidate inputs differ from pre-build evidence");

const candidateArchivePath = join(scratchRoot, "candidate.tar");
const candidateArchiveBytes = await readFile(candidateArchivePath);
const rawIndex = JSON.parse(await readFile(join(runRoot, "all-processes-raw", "INDEX.json"), "utf8"));
const sourceV5Process = rawIndex.records.find(record => record.status === 1
  && record.args?.[0]?.endsWith("/harness/verify-v5.mjs"));
if (!sourceV5Process) throw new Error("failed source v5 process record is absent");
const sourceV5Stem = String(sourceV5Process.sequence).padStart(3, "0");
const sourceV5StdoutPath = join(runRoot, "all-processes-raw", `${sourceV5Stem}.stdout`);
const sourceV5StderrPath = join(runRoot, "all-processes-raw", `${sourceV5Stem}.stderr`);
const sourceV5Stdout = await readFile(sourceV5StdoutPath);
const sourceV5Stderr = await readFile(sourceV5StderrPath);
const sourceV5 = JSON.parse(sourceV5Stdout.toString());
const failedCases = sourceV5.results.filter(result => !result.pass);
if (failedCases.length !== 2 || failedCases[0].id !== "V5-023" || failedCases[1].id !== "V5-024") {
  throw new Error("unexpected fresh-suite failure set");
}
const environmentRecord = sourceV5.results.find(result => result.name.startsWith("literal 1500-byte"));
if (!environmentRecord?.pass || !environmentRecord.observation.table.every(row => row.pass)) {
  throw new Error("nested environment table did not pass every row");
}
const metadataDuRecords = sourceV5.results.slice(0, 19);
if (metadataDuRecords.length !== 19 || metadataDuRecords.some(result => !result.pass)) {
  throw new Error("metadata/DU prefix did not pass 19/19");
}
const authorizedDirectoryAtimeDeltas = metadataDuRecords.reduce(
  (sum, result) => sum + result.observation.statDeltas.length, 0,
);
const unauthorizedMetadataDeltas = metadataDuRecords.flatMap(
  result => result.observation.unauthorizedStatDeltas,
);
if (metadataDuRecords.some(result => result.observation.statDeltas.some(delta =>
  delta.field !== "atimeMs" || delta.type !== "directory"))) {
  throw new Error("metadata/DU prefix contains a non-directory-atime delta");
}
if (unauthorizedMetadataDeltas.length) throw new Error("metadata/DU prefix contains unauthorized deltas");

const sourceOriginalStdout = await readFile(join(runRoot, "source-original.stdout"));
const sourceOriginalStderr = await readFile(join(runRoot, "source-original.stderr"));
const sourceOriginal = JSON.parse(sourceOriginalStdout.toString());
if (sourceOriginal.summary.total !== 24 || sourceOriginal.summary.passed !== 24) {
  throw new Error("original source suite did not pass 24/24");
}

const roots = [...bootstrapClosure.closure.spawnedRootPids, ...failedClosure.processClosure.spawnedRootPids];
const groups = [...bootstrapClosure.closure.spawnedProcessGroups, ...failedClosure.processClosure.spawnedProcessGroups];
const timeoutControl = JSON.parse(await readFile(join(runRoot, "process-timeout-grandchild-closure.json"), "utf8"));
const closureProbe = {
  probedAt: new Date().toISOString(),
  bootstrapRootRecords: bootstrapClosure.closure.spawnedRootPids.length,
  materializedRootRecords: failedClosure.processClosure.spawnedRootPids.length,
  totalRootRecords: roots.length,
  totalGroupRecords: groups.length,
  liveRootPids: roots.filter(processTargetExists),
  liveProcessGroups: groups.filter(pgid => processTargetExists(-pgid)),
  timeoutGrandchildPid: timeoutControl.grandchildPid,
  timeoutGrandchildAlive: processTargetExists(timeoutControl.grandchildPid),
};
if (closureProbe.liveRootPids.length || closureProbe.liveProcessGroups.length
  || closureProbe.timeoutGrandchildAlive) {
  throw new Error("an owned replay process remains alive");
}

const allRetainedPaths = [
  ...scratch.files.map(file => file.path), ...scratch.directories, ...scratch.links.map(link => link.path),
  ...bootstrap.files.map(file => file.path), ...bootstrap.directories, ...bootstrap.links.map(link => link.path),
];
const forbiddenAgents = allRetainedPaths.filter(path => /(^|\/)AGENTS\.md$/u.test(path));
if (forbiddenAgents.length) throw new Error(`forbidden retained AGENTS path: ${forbiddenAgents.join(", ")}`);

const materializedFinally = JSON.parse(await readFile(join(runRoot, "materialized-finally-before-cleanup.json"), "utf8"));
const materializedAfterChild = JSON.parse(await readFile(join(replayRoot, "BOOTSTRAP-POSTCHECK.json"), "utf8"));
const scratchDocument = {
  schema: 1,
  disposition: "inventory captured before exact owned scratch removal after frozen v8 replay failure",
  scratch,
  candidateArchive: {
    path: candidateArchivePath,
    bytes: candidateArchiveBytes.byteLength,
    sha256: sha256(candidateArchiveBytes),
  },
  source,
  generatedDist: dist,
  selectedInputsAfterExcludingDist: sourceInputsAfter,
  selectedInputsUnchanged: sourceInputsUnchanged,
  forbiddenAgents,
};
const bootstrapDocument = {
  schema: 1,
  disposition: "inventory captured before exact owned bootstrap scratch removal after frozen v8 replay failure",
  bootstrap,
  forbiddenAgents,
};
const failureAnalysis = {
  schema: 1,
  decision: "V8_REPLAY_REJECTED_AS_FROZEN_FIXTURE_ATIME_PRECONDITION_FAILURE",
  candidate: "9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d",
  freeze: "ae0f8b3f4f927b06718fc51e176ca7a54b517364",
  sourceOriginal: {
    summary: sourceOriginal.summary,
    stdoutBytes: sourceOriginalStdout.byteLength,
    stdoutSha256: sha256(sourceOriginalStdout),
    stderrBytes: sourceOriginalStderr.byteLength,
    stderrSha256: sha256(sourceOriginalStderr),
  },
  sourceFresh: {
    summary: sourceV5.summary,
    stdoutPath: relative(replayRoot, sourceV5StdoutPath).replaceAll("\\", "/"),
    stdoutBytes: sourceV5Stdout.byteLength,
    stdoutSha256: sha256(sourceV5Stdout),
    stderrPath: relative(replayRoot, sourceV5StderrPath).replaceAll("\\", "/"),
    stderrBytes: sourceV5Stderr.byteLength,
    stderrSha256: sha256(sourceV5Stderr),
    failedCases,
    literalEnvironmentRecord: environmentRecord,
  },
  metadataDu: {
    passed: 19,
    total: 19,
    authorizedDirectoryAtimeDeltas,
    unauthorizedDeltas: unauthorizedMetadataDeltas.length,
  },
  failureClassification: {
    candidateProductDefectEstablished: false,
    v5023: "forced-old setup was observed, but file atime advanced before the recorded pre-read lstat sample; the product phase is not involved",
    v5024: "forced-old setup was observed, but file atime advanced before the recorded mutant pre-action sample; root directory atime remained old and the later exact readdir delta was narrowly authorized",
    consequence: "the frozen atime controls did not retain their required preconditions and cannot support candidate acceptance",
  },
  reached: [
    "freeze/candidate resolution and admission",
    "timeout/grandchild control",
    "candidate archive/extraction",
    "source build",
    "original source suite",
    "fresh source suite",
  ],
  unexecuted: [
    "scoped regressions",
    "npm pack dry-run and actual npm package",
    "offline package install and physical consumer move",
    "strict moved-consumer typecheck and runtime",
    "moved original/fresh suites and nextLoad attestation",
    "wrong-root, missing-DU, restored-cleanup and declaration controls",
    "native 16-row GNU environment table",
  ],
  frozenPostchecks: { materializedFinally, materializedAfterChild },
  processClosure: closureProbe,
  forbiddenAgents,
  scratchBasename: basename(scratchRoot),
  bootstrapScratchBasename: basename(bootstrapScratch),
};

await writeFile(join(runRoot, "RETAINED_SCRATCH_INVENTORY.json"), json(scratchDocument), { flag: "wx" });
await writeFile(join(runRoot, "BOOTSTRAP_SCRATCH_INVENTORY.json"), json(bootstrapDocument), { flag: "wx" });
await writeFile(join(runRoot, "FAILURE_ANALYSIS.json"), json(failureAnalysis), { flag: "wx" });
await writeFile(join(runRoot, "POST_RUN_PROCESS_PROBE.json"), json(closureProbe), { flag: "wx" });

await rm(scratchRoot, { recursive: true, force: false });
await rm(bootstrapScratch, { recursive: true, force: false });
const scratchAbsent = await absent(scratchRoot);
const bootstrapScratchAbsent = await absent(bootstrapScratch);
if (!scratchAbsent || !bootstrapScratchAbsent) throw new Error("owned scratch cleanup did not reach ENOENT");
const scratchClosed = {
  schema: 1,
  removedAt: new Date().toISOString(),
  workScratch: { basename: basename(scratchRoot), actualPostCleanupStat: "ENOENT" },
  bootstrapScratch: { basename: basename(bootstrapScratch), actualPostCleanupStat: "ENOENT" },
  processClosure: closureProbe,
};
await writeFile(join(runRoot, "SCRATCH-CLOSED.json"), json(scratchClosed), { flag: "wx" });
process.stdout.write(json({
  sourceOriginal: sourceOriginal.summary,
  sourceFresh: sourceV5.summary,
  metadataDu: failureAnalysis.metadataDu,
  closureProbe,
  scratchClosed,
}));
