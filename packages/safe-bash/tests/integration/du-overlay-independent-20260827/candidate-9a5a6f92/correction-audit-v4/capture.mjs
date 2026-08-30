import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const candidate = "9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d";
const expected = {
  tarball: "17ea61cadba802e971cdefd545a56c889d28540b378142870cabacab12b67159",
  du: "b8257103248aa0f4a21cb6dab6d916661a5fb04423e414475e68370807cdc5c4",
  overlay: "17244dcf61fe1c33ceb07e9af5d8f87689a76d1895de2594cc0a0be068ea5737",
};
const owner = dirname(fileURLToPath(import.meta.url));
const repo = resolve(process.cwd());
const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
const evidence = join(owner, "evidence", `observer-neutral-${timestamp}`);
await mkdir(evidence, { recursive: true });
const scratch = await mkdtemp(join(owner, ".scratch-"));
const steps = [];

function digest(bytes, algorithm = "sha256") {
  return createHash(algorithm).update(bytes).digest("hex");
}

async function fileDigest(path, algorithm = "sha256") {
  return digest(await readFile(path), algorithm);
}

function gitBlobId(bytes) {
  return digest(Buffer.concat([Buffer.from(`blob ${bytes.byteLength}\0`), bytes]), "sha1");
}

async function run(name, command, args, options = {}) {
  const startedAt = new Date().toISOString();
  const child = spawn(command, args, {
    cwd: options.cwd ?? repo,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
  const status = await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => resolvePromise({ code, signal }));
  });
  const out = Buffer.concat(stdout);
  const err = Buffer.concat(stderr);
  await writeFile(join(evidence, `${name}.stdout`), out);
  await writeFile(join(evidence, `${name}.stderr`), err);
  const record = {
    name,
    command,
    args,
    cwd: options.cwd ?? repo,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: status.code,
    signal: status.signal,
    stdoutSha256: digest(out),
    stderrSha256: digest(err),
  };
  steps.push(record);
  if (status.code !== 0) throw new Error(`${name} failed with exit ${status.code}: ${err.toString().slice(0, 500)}`);
  return out;
}

async function walkFiles(root) {
  const result = [];
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(relative(root, path).split(sep).join("/"));
    }
  };
  await visit(root);
  return result.sort();
}

let manifest;
let failure;
try {
  const candidateType = (await run("candidate-type", "git", ["cat-file", "-t", candidate])).toString().trim();
  if (candidateType !== "commit") throw new Error(`candidate is ${candidateType}, not commit`);
  const allPathsRaw = await run("candidate-tree-names", "git", ["ls-tree", "-r", "-z", "--name-only", candidate]);
  const allPaths = allPathsRaw.toString().split("\0").filter(Boolean);
  const selectedPaths = allPaths.filter(path => path === "package.json" || path === "package-lock.json"
    || path === "tsconfig.json" || path === "tsconfig.build.json" || path.startsWith("src/"));
  const selectedAgents = selectedPaths.filter(path => basename(path) === "AGENTS.md");
  const archiveGuard = {
    evaluatedBeforeArchive: true,
    candidateAgentsPaths: allPaths.filter(path => basename(path) === "AGENTS.md"),
    selectedAgentsPaths: selectedAgents,
    selectedPathCount: selectedPaths.length,
  };
  if (selectedAgents.length) throw new Error(`AGENTS.md rejected before archive: ${selectedAgents.join(", ")}`);
  if (selectedPaths.length === 0) throw new Error("empty selected archive");

  const treeRaw = await run("selected-tree", "git", ["ls-tree", "-r", "-z", candidate, "--", ...selectedPaths]);
  const treeEntries = treeRaw.toString().split("\0").filter(Boolean).map(record => {
    const match = /^(\d+) blob ([0-9a-f]{40})\t(.+)$/u.exec(record);
    if (!match) throw new Error(`unexpected selected tree record: ${record}`);
    return { mode: match[1], blob: match[2], path: match[3] };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (!equalArrays(treeEntries.map(entry => entry.path), selectedPaths.slice().sort())) {
    throw new Error("selected Git tree did not resolve the exact requested paths");
  }
  const archive = join(scratch, "candidate-selected.tar");
  await run("git-archive", "git", ["archive", "--format=tar", `--output=${archive}`, candidate, "--", ...selectedPaths]);
  const source = join(scratch, "source");
  await mkdir(source);
  await run("extract", "tar", ["-xf", archive, "-C", source]);
  const extractedPaths = await walkFiles(source);
  const extractedAgents = extractedPaths.filter(path => basename(path) === "AGENTS.md");
  if (extractedAgents.length) throw new Error(`AGENTS.md found after extraction: ${extractedAgents.join(", ")}`);
  if (!equalArrays(extractedPaths, selectedPaths.slice().sort())) throw new Error("archive extracted file set differs from selected Git paths");
  const extractedBindings = [];
  for (const entry of treeEntries) {
    const bytes = await readFile(join(source, entry.path));
    extractedBindings.push({ path: entry.path, expectedBlob: entry.blob, actualBlob: gitBlobId(bytes), sha256: digest(bytes) });
  }
  if (extractedBindings.some(entry => entry.expectedBlob !== entry.actualBlob)) throw new Error("extracted input blob mismatch");

  await run("npm-ci", "npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: source });
  await run("build", "npm", ["run", "build"], { cwd: source });
  const builtHashes = {
    du: await fileDigest(join(source, "dist/commands/du/index.js")),
    overlay: await fileDigest(join(source, "dist/fs/overlay/index.js")),
  };
  if (builtHashes.du !== expected.du || builtHashes.overlay !== expected.overlay) {
    throw new Error(`built hash mismatch: ${JSON.stringify(builtHashes)}`);
  }

  const packDirectory = join(scratch, "pack");
  await mkdir(packDirectory);
  const packOutput = await run("npm-pack", "npm", ["pack", "--json", `--pack-destination=${packDirectory}`], { cwd: source });
  const packRecord = JSON.parse(packOutput.toString());
  const tarball = join(packDirectory, packRecord[0].filename);
  const tarballSha256 = await fileDigest(tarball);
  if (tarballSha256 !== expected.tarball) throw new Error(`tarball hash mismatch: ${tarballSha256}`);

  const consumer = join(scratch, "consumer-before-move");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), `${JSON.stringify({ name: "observer-neutral-consumer", private: true, type: "module" }, null, 2)}\n`);
  await run("consumer-install", "npm", ["install", "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund", tarball], { cwd: consumer });
  const movedParent = join(scratch, "relocated-after-install");
  await mkdir(movedParent);
  const movedConsumer = join(movedParent, "moved-consumer");
  await rename(consumer, movedConsumer);
  const installedRoot = join(movedConsumer, "node_modules", "virtual-bash");
  const installedStat = await stat(installedRoot);
  if (!installedStat.isDirectory()) throw new Error("moved installed package is missing");

  const loadedRelativePaths = [
    "dist/fs/memory/index.js",
    "dist/fs/overlay/index.js",
    "dist/fs/readonly/index.js",
    "dist/fs/mount/index.js",
    "dist/commands/du/index.js",
    "dist/contracts/index.js",
  ];
  const installedModuleBindings = [];
  for (const path of loadedRelativePaths) {
    const sourceSha256 = await fileDigest(join(source, path));
    const installedSha256 = await fileDigest(join(installedRoot, path));
    installedModuleBindings.push({ path, sourceSha256, installedSha256, match: sourceSha256 === installedSha256 });
  }
  if (installedModuleBindings.some(entry => !entry.match)) throw new Error("installed loaded-module hash mismatch");

  const diagnostic = join(owner, "observer-neutral-diagnostic.mjs");
  const sourceResultPath = join(evidence, "source-diagnostic.json");
  const packageResultPath = join(evidence, "moved-package-diagnostic.json");
  await run("source-diagnostic", process.execPath, [diagnostic, source, "authenticated-source-build", sourceResultPath]);
  await run("moved-package-diagnostic", process.execPath, [diagnostic, installedRoot, "moved-installed-package", packageResultPath]);
  const sourceResult = JSON.parse(await readFile(sourceResultPath, "utf8"));
  const packageResult = JSON.parse(await readFile(packageResultPath, "utf8"));
  const postInputBindings = [];
  for (const entry of treeEntries) {
    const bytes = await readFile(join(source, entry.path));
    postInputBindings.push({ path: entry.path, expectedBlob: entry.blob, actualBlob: gitBlobId(bytes) });
  }
  const selectedInputsImmutableAfterRun = postInputBindings.every(entry => entry.expectedBlob === entry.actualBlob);
  if (!selectedInputsImmutableAfterRun) throw new Error("selected source input changed during capture");
  manifest = {
    schema: 1,
    date: "2026-08-27",
    exactCandidate: candidate,
    refinedFreeze: "8c28d7c848311372cbef5ec3e4facff546baf0a8",
    classification: "post-candidate-inspection diagnostic; not a frozen holdout",
    archiveGuard,
    archive: {
      pathWasTemporaryOwnedScratch: true,
      sha256: await fileDigest(archive),
      selectedPathCount: selectedPaths.length,
      selectedTreeSha256: digest(Buffer.from(JSON.stringify(treeEntries))),
      selectedPaths,
      extractedAgentsPaths: extractedAgents,
      exactBlobBindingsPassed: extractedBindings.every(entry => entry.expectedBlob === entry.actualBlob),
      selectedInputsImmutableAfterRun,
    },
    build: { builtHashes, expectedHashes: { du: expected.du, overlay: expected.overlay } },
    package: {
      installedBeforeMove: true,
      movedToDistinctPath: true,
      tarballSha256,
      expectedTarballSha256: expected.tarball,
      reusedPriorAuthenticatedTarballHash: tarballSha256 === expected.tarball,
      loadedModuleBindings: installedModuleBindings,
      full789FileAuditNotRepeated: true,
    },
    diagnostic: {
      sourceOutput: basename(sourceResultPath),
      movedPackageOutput: basename(packageResultPath),
      sourceFailedIntegrityChecks: sourceResult.failedIntegrityChecks,
      movedPackageFailedIntegrityChecks: packageResult.failedIntegrityChecks,
      summariesEqual: equalObjects(sourceResult.summary, packageResult.summary),
    },
    steps,
  };
} catch (caught) {
  failure = { name: caught?.name ?? typeof caught, message: caught?.message ?? String(caught), stack: caught?.stack };
} finally {
  const ownedPrefix = `${owner}${sep}.scratch-`;
  if (!scratch.startsWith(ownedPrefix)) throw new Error(`refusing unsafe scratch cleanup: ${scratch}`);
  await rm(scratch, { recursive: true, force: true });
}

const scratchRemoved = await stat(scratch).then(() => false, error => error?.code === "ENOENT");
if (manifest) {
  manifest.cleanup = { scratchRemoved, spawnedChildrenSettled: true };
  await writeFile(join(evidence, "capture-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${evidence}\n`);
} else {
  await writeFile(join(evidence, "capture-failure.json"), `${JSON.stringify({ failure, steps, cleanup: { scratchRemoved } }, null, 2)}\n`);
  throw new Error(`capture failed; see ${evidence}`, { cause: failure });
}

function equalArrays(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function equalObjects(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
