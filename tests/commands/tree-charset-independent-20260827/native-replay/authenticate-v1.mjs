import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const FREEZE_COMMIT = "55bd112804564605e397d3ee9948226d89efd457";
const CANDIDATE_COMMIT = "f1a90436c45208ca248e058a039893233c608daa";
const HANDOFF_COMMIT = "0d8623634995549d8e717d310c28db83a02a9532";
const EXPECTED_ARCHIVE_SHA256 = "fe133818ee69dcbdac7e2330e97fefa1dd07037ba73c6135ccf106b770e7f325";
const EXPECTED_PACK_SHA256 = "2713175a12912952999c6e0e8d81cef2638692b573081bc281ba0e785d099bab";
const EXPECTED_PACKAGE_SHA256 = "2127bbfed020aeb7873462ae65224e6ee73069425c878aa2ceee9816b2191245";
const EXPECTED_ENTRY_SHA256 = "77b771a6066aa32f82b903f7a80c578132388d6d9cec9fbde15485915859df5d";
const EXPECTED_TREE_SHA256 = "702a5d511ede375a30473275f8428b84f7b4c44b7caa706ba3796d5e9b94140a";

function argumentsMap() {
  const result = Object.create(null);
  for (let index = 2; index < process.argv.length; index += 2) result[process.argv[index].slice(2)] = resolve(process.argv[index + 1]);
  for (const key of ["repo", "runtime", "results", "output"]) if (!result[key]) throw new Error(`missing --${key}`);
  return result;
}

async function hashFile(path, algorithm = "sha256") {
  const hash = createHash(algorithm);
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest("hex"), bytes };
}

function run(repo, args, options = {}) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: repo,
    env: { PATH: "/usr/bin:/bin" },
    encoding: options.encoding ?? "utf8",
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

async function hashGitArchive(repo) {
  return await new Promise((resolveClose, reject) => {
    const child = spawn("git", ["archive", "--format=tar", CANDIDATE_COMMIT], {
      cwd: repo,
      env: { PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const hash = createHash("sha256");
    let bytes = 0;
    const errors = [];
    let errorBytes = 0;
    child.stdout.on("data", chunk => { hash.update(chunk); bytes += chunk.length; });
    child.stderr.on("data", chunk => {
      errorBytes += chunk.length;
      if (errorBytes <= 65536) errors.push(Buffer.from(chunk));
      else child.kill("SIGKILL");
    });
    child.on("error", reject);
    const deadline = setTimeout(() => child.kill("SIGKILL"), 30000);
    child.on("close", (code, signal) => {
      clearTimeout(deadline);
      if (code !== 0 || signal !== null) return reject(new Error(`git archive close code=${code} signal=${signal}: ${Buffer.concat(errors)}`));
      resolveClose({ sha256: hash.digest("hex"), bytes, closeEventObserved: true, close: { code, signal } });
    });
  });
}

async function directoryManifest(root) {
  const records = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) {
        const hashed = await hashFile(full);
        records.push({ path: relative(root, full), bytes: hashed.bytes, sha256: hashed.sha256 });
      } else throw new Error(`unexpected package entry type: ${full}`);
    }
  }
  await visit(root);
  records.sort((left, right) => left.path.localeCompare(right.path));
  return records;
}

async function main() {
  const options = argumentsMap();
  const candidateRoot = join(options.runtime, "candidate");
  const installedRoot = join(options.runtime, "install-moved/node_modules/virtual-bash");
  const packPath = join(options.runtime, "pack/virtual-bash-0.0.0.tgz");
  const freezeRoot = join(options.runtime, "freeze");
  const results = JSON.parse(await readFile(options.results, "utf8"));

  const checksumLines = (await readFile(join(freezeRoot, "SHA256SUMS"), "utf8")).trim().split("\n");
  const freezeChecks = [];
  for (const line of checksumLines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/u);
    if (!match) throw new Error(`invalid frozen checksum line: ${line}`);
    const observed = await hashFile(join(freezeRoot, match[2]));
    freezeChecks.push({ path: match[2], expectedSha256: match[1], observedSha256: observed.sha256, pass: match[1] === observed.sha256 });
  }

  const tree = run(options.repo, ["git", "rev-parse", `${CANDIDATE_COMMIT}^{tree}`]).trim();
  const parent = run(options.repo, ["git", "rev-parse", `${CANDIDATE_COMMIT}^`]).trim();
  const freshArchive = await hashGitArchive(options.repo);
  const copiedArchive = await hashFile(join(options.runtime, "candidate-f1a90436.tar"));

  const lsTree = run(options.repo, ["git", "ls-tree", "-r", "-z", CANDIDATE_COMMIT, "--", "src", "package.json", "tsconfig.json", "tsconfig.build.json", "tsconfig.tests.json"], { encoding: "buffer" });
  const selected = [];
  for (const record of Buffer.from(lsTree).toString("utf8").split("\0").filter(Boolean)) {
    const match = record.match(/^\d+ blob ([0-9a-f]{40})\t(.+)$/u);
    if (!match) throw new Error(`unexpected ls-tree record: ${record}`);
    const bytes = await readFile(join(candidateRoot, match[2]));
    const observedBlob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    selected.push({ path: match[2], expectedBlob: match[1], observedBlob, pass: match[1] === observedBlob });
  }

  const sourcePackage = await hashFile(join(candidateRoot, "package.json"));
  const sourceEntry = await hashFile(join(candidateRoot, "dist/index.js"));
  const sourceTree = await hashFile(join(candidateRoot, "dist/commands/tree/index.js"));
  const installedPackage = await hashFile(join(installedRoot, "package.json"));
  const installedEntry = await hashFile(join(installedRoot, "dist/index.js"));
  const installedTree = await hashFile(join(installedRoot, "dist/commands/tree/index.js"));
  const pack = await hashFile(packPath);

  const extractRoot = await mkdtemp(join(options.runtime, "auth-pack."));
  try {
    run(options.repo, ["tar", "-xzf", packPath, "-C", extractRoot]);
    const packedManifest = await directoryManifest(join(extractRoot, "package"));
    const installedManifest = await directoryManifest(installedRoot);
    const packedJson = JSON.stringify(packedManifest);
    const installedJson = JSON.stringify(installedManifest);

    const handoff = run(options.repo, ["git", "show", `${HANDOFF_COMMIT}:benchmarks/reports/tree-charset-20260827/README.md`]);
    const handoffLines = handoff.split("\n");
    const consumerPath = join(options.repo, "tests/commands/tree-charset-independent-20260827/native-replay/installed-consumer-v2.mjs");
    const runtimeConsumerPath = join(options.runtime, "install-moved/replay-consumer-v2.mjs");
    const consumer = await hashFile(consumerPath);
    const runtimeConsumer = await hashFile(runtimeConsumerPath);
    const nodeBinary = await hashFile(process.execPath);

    const boundaries = Object.fromEntries(["source-build", "installed-package"].map(boundary => {
      const records = results.records.filter(item => item.boundary === boundary);
      const first = records[0].virtual;
      return [boundary, {
        cases: records.length,
        allRegistryCount70: records.every(item => item.virtual.registry.count === 70),
        allRegistryHasTree: records.every(item => item.virtual.registry.hasTree),
        registryNamesSha256: createHash("sha256").update(JSON.stringify(first.registry.names)).digest("hex"),
        allRegistryNamesIdentical: records.every(item => JSON.stringify(item.virtual.registry.names) === JSON.stringify(first.registry.names)),
        loaded: first.loaded,
        allLoadedIdentitiesIdentical: records.every(item => JSON.stringify(item.virtual.loaded) === JSON.stringify(first.loaded)),
      }];
    }));

    const authentication = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      chronology: "native freeze was committed after candidate source commit; replay occurred after freeze commit and source inspection; no pre-source independent freeze exists",
      freeze: {
        commit: FREEZE_COMMIT,
        artifactChecks: freezeChecks,
        allArtifactsAuthenticated: freezeChecks.every(item => item.pass),
        captureSha256: (await hashFile(join(freezeRoot, "native-capture.json"))).sha256,
      },
      candidate: {
        commit: CANDIDATE_COMMIT,
        tree,
        parent,
        freshGitArchive: freshArchive,
        copiedGitArchive: copiedArchive,
        expectedArchiveSha256: EXPECTED_ARCHIVE_SHA256,
        archiveAuthenticated: freshArchive.sha256 === EXPECTED_ARCHIVE_SHA256 && copiedArchive.sha256 === EXPECTED_ARCHIVE_SHA256,
        selectedSourceBuildInputs: { count: selected.length, mismatches: selected.filter(item => !item.pass), allMatch: selected.every(item => item.pass) },
        independentBuildInvocation: "node node_modules/typescript/bin/tsc -p tsconfig.build.json",
        independentBuildExitCode: 0,
        packageJson: sourcePackage,
        rootEntry: sourceEntry,
        treeEntry: sourceTree,
      },
      authorHandoff: {
        commit: HANDOFF_COMMIT,
        path: "benchmarks/reports/tree-charset-20260827/README.md",
        gitBlob: run(options.repo, ["git", "rev-parse", `${HANDOFF_COMMIT}:benchmarks/reports/tree-charset-20260827/README.md`]).trim(),
        sha256: createHash("sha256").update(handoff).digest("hex"),
        line134: handoffLines[133],
      },
      package: {
        pack: { path: packPath, ...pack, expectedSha256: EXPECTED_PACK_SHA256, pass: pack.sha256 === EXPECTED_PACK_SHA256 },
        installedRoot,
        packedFileCount: packedManifest.length,
        installedFileCount: installedManifest.length,
        packedManifestSha256: createHash("sha256").update(packedJson).digest("hex"),
        installedManifestSha256: createHash("sha256").update(installedJson).digest("hex"),
        packAndInstalledExactMatch: packedJson === installedJson,
        packageJson: installedPackage,
        rootEntry: installedEntry,
        treeEntry: installedTree,
        expected: { packageSha256: EXPECTED_PACKAGE_SHA256, rootEntrySha256: EXPECTED_ENTRY_SHA256, treeEntrySha256: EXPECTED_TREE_SHA256 },
      },
      installedConsumer: {
        committedPath: consumerPath,
        runtimePath: runtimeConsumerPath,
        committedSha256: consumer.sha256,
        runtimeSha256: runtimeConsumer.sha256,
        hashesMatch: consumer.sha256 === runtimeConsumer.sha256,
        literalBareRootImportPresent: (await readFile(consumerPath, "utf8")).includes('await import("virtual-bash")'),
        noSourceImportPresent: !(await readFile(consumerPath, "utf8")).includes("/src/"),
      },
      replay: {
        resultsPath: options.results,
        totals: results.totals,
        boundaries,
        allLoadedPathsWithinExpectedBoundary: results.records.every(item => item.boundary === "source-build"
          ? item.virtual.loaded.entryPath.startsWith(`${candidateRoot}/dist/`) && item.virtual.loaded.treePath.startsWith(`${candidateRoot}/dist/`)
          : item.virtual.loaded.entryPath.startsWith(`${installedRoot}/dist/`) && item.virtual.loaded.treePath.startsWith(`${installedRoot}/dist/`)),
        installedLoadedNoSourcePaths: results.records.filter(item => item.boundary === "installed-package").every(item => !item.virtual.loaded.entryPath.includes("/src/") && !item.virtual.loaded.treePath.includes("/src/")),
      },
      node: { path: process.execPath, version: process.version, sha256: nodeBinary.sha256 },
    };
    await mkdir(join(options.output, ".."), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(authentication, null, 2)}\n`);
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }
}

await main();
