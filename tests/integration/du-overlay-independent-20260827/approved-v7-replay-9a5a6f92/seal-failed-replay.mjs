import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, realpath, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

const replayRoot = await realpath(resolve(process.argv[2] ?? ""));
const runRoot = await realpath(resolve(process.argv[3] ?? ""));
if (!process.argv[2] || !process.argv[3] || !runRoot.startsWith(`${replayRoot}/`)) {
  throw new Error("usage: node seal-failed-replay.mjs REPLAY_ROOT RUN_ROOT");
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
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  return {
    root,
    fileCount: files.length,
    directoryCount: directories.length,
    symlinkCount: links.length,
    totalBytes,
    files,
    directories,
    links,
    fileInventorySha256: sha256(Buffer.from(json(files))),
    completeEntryInventorySha256: sha256(Buffer.from(json({ directories, files, links }))),
  };
}

function exists(target) {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

const failedClosure = JSON.parse(await readFile(join(runRoot, "FAILED-CLOSURE.json"), "utf8"));
const bootstrapClosure = JSON.parse(await readFile(join(replayRoot, "BOOTSTRAP-PROCESS-CLOSURE.json"), "utf8"));
const scratchRoot = await realpath(failedClosure.scratchRetained);
const bootstrapScratch = await realpath(bootstrapClosure.retainedScratch);
for (const owned of [scratchRoot, bootstrapScratch]) {
  if (!owned.startsWith(`${replayRoot}/`)) throw new Error(`retained path escaped replay root: ${owned}`);
}

const scratch = await inventory(scratchRoot);
const bootstrap = await inventory(bootstrapScratch);
const sourceRoot = join(scratchRoot, "source");
const source = await inventory(sourceRoot);
const sourceInputsAfter = await inventory(sourceRoot, new Set(["dist"]));
const dist = await inventory(join(sourceRoot, "dist"));
const sourceInputsBefore = JSON.parse(await readFile(join(runRoot, "candidate-inputs-before.json"), "utf8"));
const sourceInputsUnchanged = JSON.stringify(sourceInputsAfter.files.map(({ path, bytes, sha256: hash }) => ({ path, bytes, sha256: hash })))
  === JSON.stringify(sourceInputsBefore);
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
if (failedCases.length !== 1 || failedCases[0].id !== "V5-023") {
  throw new Error("unexpected fresh-suite failure set");
}
const correctedV5024 = sourceV5.results.find(result => result.id === "V5-024");
const environmentRow = sourceV5.results.find(result => result.name.startsWith("literal 1500-byte"));
const sourceOriginalStdout = await readFile(join(runRoot, "source-original.stdout"));
const sourceOriginalStderr = await readFile(join(runRoot, "source-original.stderr"));
const sourceOriginal = JSON.parse(sourceOriginalStdout.toString());

const roots = [...bootstrapClosure.closure.spawnedRootPids, ...failedClosure.processClosure.spawnedRootPids];
const groups = [...bootstrapClosure.closure.spawnedProcessGroups, ...failedClosure.processClosure.spawnedProcessGroups];
const timeoutControl = JSON.parse(await readFile(join(runRoot, "process-timeout-grandchild-closure.json"), "utf8"));
const closureProbe = {
  probedAt: new Date().toISOString(),
  bootstrapRootRecords: bootstrapClosure.closure.spawnedRootPids.length,
  materializedRootRecords: failedClosure.processClosure.spawnedRootPids.length,
  totalRootRecords: roots.length,
  totalGroupRecords: groups.length,
  liveRootPids: roots.filter(exists),
  liveProcessGroups: groups.filter(pgid => exists(-pgid)),
  timeoutGrandchildPid: timeoutControl.grandchildPid,
  timeoutGrandchildAlive: exists(timeoutControl.grandchildPid),
};
if (closureProbe.liveRootPids.length || closureProbe.liveProcessGroups.length || closureProbe.timeoutGrandchildAlive) {
  throw new Error("an owned process remains alive");
}

const allPaths = [
  ...scratch.files.map(file => file.path), ...scratch.directories, ...scratch.links.map(link => link.path),
  ...bootstrap.files.map(file => file.path), ...bootstrap.directories, ...bootstrap.links.map(link => link.path),
];
const forbiddenAgents = allPaths.filter(path => /(^|\/)AGENTS\.md$/u.test(path));
if (forbiddenAgents.length) throw new Error(`forbidden retained AGENTS path: ${forbiddenAgents.join(", ")}`);

const scratchDocument = {
  schema: 1,
  disposition: "inventory captured before exact owned scratch removal after frozen replay failure",
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
  disposition: "inventory captured before exact owned bootstrap scratch removal after frozen replay failure",
  bootstrap,
  forbiddenAgents,
};
const failureAnalysis = {
  schema: 1,
  decision: "V7_REPLAY_REJECTED_AS_FROZEN_FIXTURE_FAILURE",
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
    correctedV5024,
    literalEnvironmentRecord: environmentRow,
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
  processClosure: closureProbe,
  forbiddenAgents,
  scratchBasename: basename(scratchRoot),
  bootstrapScratchBasename: basename(bootstrapScratch),
};

await writeFile(join(runRoot, "RETAINED_SCRATCH_INVENTORY.json"), json(scratchDocument), { flag: "wx" });
await writeFile(join(runRoot, "BOOTSTRAP_SCRATCH_INVENTORY.json"), json(bootstrapDocument), { flag: "wx" });
await writeFile(join(runRoot, "FAILURE_ANALYSIS.json"), json(failureAnalysis), { flag: "wx" });
await writeFile(join(runRoot, "POST_RUN_PROCESS_PROBE.json"), json(closureProbe), { flag: "wx" });
process.stdout.write(json({ scratchRoot, bootstrapScratch, sourceFresh: sourceV5.summary, closureProbe }));
