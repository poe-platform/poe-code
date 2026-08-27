import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXACT_CANDIDATE = "9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d";
const FROZEN_RELATIVE = "tests/integration/du-overlay-independent-20260827/approved-v5-9a5a6f92";
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
const repository = resolve(materialized ? process.env.V5_REPOSITORY ?? "" : join(taskRoot, "../../../.."));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const activeChildren = new Set();
const allChildPids = [];

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repository,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    activeChildren.add(child.pid);
    allChildPids.push(child.pid);
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
    child.on("error", rejectPromise);
    child.on("close", (status, signal) => {
      activeChildren.delete(child.pid);
      resolvePromise({ command, args, status, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    child.stdin.end(options.input);
  });
}

async function success(result, label) {
  if (result.status !== 0) throw new Error(`${label} failed (${result.status}): ${result.stderr.toString()}`);
  return result;
}

async function failure(result, label) {
  if (result.status === 0) throw new Error(`${label} unexpectedly passed`);
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

async function frozenManifest() {
  const bytes = await gitBytes(freezeCommit, `${FROZEN_RELATIVE}/MANIFEST.json`);
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
  return { manifest, tree, bytes };
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

if (!materialized) {
  const repositoryReal = await realpath(repository);
  const gitRoot = (await success(await run("git", ["rev-parse", "--show-toplevel"]), "repository root")).stdout.toString().trim();
  if (await realpath(gitRoot) !== repositoryReal) throw new Error("wrong repository root");
  const resolvedFreeze = (await success(await run("git", ["rev-parse", `${freezeCommit}^{commit}`]), "freeze resolution")).stdout.toString().trim();
  const resolvedCandidate = (await success(await run("git", ["rev-parse", `${candidate}^{commit}`]), "candidate resolution")).stdout.toString().trim();
  if (resolvedFreeze !== freezeCommit || resolvedCandidate !== candidate) throw new Error("mutable or mismatched revision resolution");
  const freeze = await frozenManifest();
  await selectedCandidatePaths(freeze.manifest);
  const admissionControl = executableNegativeAdmissionControl();
  const ownBytes = await readFile(fileURLToPath(import.meta.url));
  const ownRecord = freeze.manifest.files.find(file => file.path === "replay.mjs");
  if (!ownRecord || sha256(ownBytes) !== ownRecord.sha256) throw new Error("bootstrap runner bytes differ from freeze commit");
  try { await stat(resultDirectory); throw new Error("result subdir already exists"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!resultDirectory.startsWith(`${repositoryReal}/`) || resultDirectory.startsWith(`${resolve(repositoryReal, FROZEN_RELATIVE)}/`)) {
    throw new Error("result subdir must be a new separately owned path inside this repository and outside frozen bytes");
  }
  await mkdir(resultDirectory, { recursive: false });
  const bootstrapScratch = await mkdir(join(resultDirectory, "bootstrap-scratch"), { recursive: false }).then(() => join(resultDirectory, "bootstrap-scratch"));
  const archive = join(bootstrapScratch, "freeze.tar");
  await success(await run("git", ["archive", "--format=tar", `--output=${archive}`, freezeCommit, "--", FROZEN_RELATIVE]), "freeze archive");
  const archivePaths = await tarPaths(archive);
  admitNoAgents(archivePaths, "freeze-pre-extraction");
  if (JSON.stringify(archivePaths.sort()) !== JSON.stringify(freeze.tree.sort())) throw new Error("freeze archive inventory mismatch");
  const extracted = join(bootstrapScratch, "extracted");
  await mkdir(extracted);
  await success(await run("tar", ["-xf", archive, "-C", extracted]), "freeze extraction");
  await writeFile(join(resultDirectory, "bootstrap.json"), json({ freezeCommit, candidate, admissionControl, freezeManifestSha256: sha256(freeze.bytes), freezeArchiveSha256: sha256(await readFile(archive)) }), { flag: "wx" });
  const frozenRunner = join(extracted, FROZEN_RELATIVE, "replay.mjs");
  const child = await run(process.execPath, [frozenRunner, "--materialized", freezeCommit, candidate, resultDirectory, nativeDu], {
    env: { ...process.env, V5_REPOSITORY: repositoryReal },
  });
  if (child.status === 0) {
    await rm(bootstrapScratch, { recursive: true, force: true });
    await writeFile(join(resultDirectory, "BOOTSTRAP-CLOSED.json"), json({ removed: true, activeChildren: [...activeChildren] }), { flag: "wx" });
  }
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  process.exitCode = child.status ?? 1;
} else {
  await executeMaterialized();
}

async function executeMaterialized() {
  const startedAt = new Date().toISOString();
  const evidence = join(resultDirectory, `run-${startedAt.replaceAll(":", "").replaceAll(".", "")}-${randomBytes(3).toString("hex")}`);
  await mkdir(evidence);
  const scratch = await mkdtemp(join(resultDirectory, "work-"));
  const steps = [];
  let protocolError;
  const save = async (name, result) => {
    await writeFile(join(evidence, `${name}.stdout`), result.stdout, { flag: "wx" });
    await writeFile(join(evidence, `${name}.stderr`), result.stderr, { flag: "wx" });
    const record = { name, command: result.command, args: result.args, status: result.status, signal: result.signal, stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr) };
    await writeFile(join(evidence, `${name}.json`), json(record), { flag: "wx" });
    steps.push(record);
    return result;
  };
  try {
    const freeze = await frozenManifest();
    const materializedInventory = await inventory(taskRoot);
    const expectedMaterialized = [...freeze.manifest.files, {
      path: "MANIFEST.json",
      bytes: freeze.bytes.byteLength,
      sha256: sha256(freeze.bytes),
    }].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    if (materializedInventory.length !== expectedMaterialized.length
      || materializedInventory.some((file, index) => file.path !== expectedMaterialized[index].path
        || file.bytes !== expectedMaterialized[index].bytes || file.sha256 !== expectedMaterialized[index].sha256)) {
      throw new Error("materialized frozen tree differs from committed manifest bytes");
    }
    const selected = await selectedCandidatePaths(freeze.manifest);
    const indexBefore = await run("git", ["diff", "--cached", "--binary"]);
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
    if (Object.keys(productPackage.dependencies ?? {}).length !== 0) throw new Error("candidate package has unexpected production dependencies");

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

    const npmEnv = { ...process.env, npm_config_cache: join(scratch, "npm-cache"), npm_config_userconfig: "/dev/null", npm_config_update_notifier: "false" };
    const pack = await save("npm-pack", await success(await run("npm", ["pack", "--json", "--pack-destination", scratch], { cwd: source, env: npmEnv }), "npm pack"));
    const packRecord = JSON.parse(pack.stdout.toString())[0];
    const tarball = join(scratch, packRecord.filename);
    const packedPaths = await tarPaths(tarball, true);
    admitNoAgents(packedPaths, "npm-package-pre-extraction");
    const unpacked = join(scratch, "unpacked");
    await mkdir(unpacked);
    await save("npm-extract", await success(await run("tar", ["-xzf", tarball, "-C", unpacked]), "npm package extraction"));
    const packedInventory = await inventory(join(unpacked, "package"));
    await writeFile(join(evidence, "packed-files.json"), json(packedInventory), { flag: "wx" });

    const stagingConsumer = join(scratch, "consumer-staging");
    const consumerInventory = await inventory(join(taskRoot, "consumer"));
    admitNoAgents(consumerInventory.map(item => item.path), "consumer-pre-copy");
    await cp(join(taskRoot, "consumer"), stagingConsumer, { recursive: true, errorOnExist: true });
    await save("consumer-install", await success(await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-save", "--package-lock=false", "--omit=dev", tarball], { cwd: stagingConsumer, env: npmEnv }), "consumer install"));
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
    await guardedCopy(movedConsumer, missingConsumer, "missing-du-consumer");
    const missingPackage = await realpath(join(missingConsumer, "node_modules", "virtual-bash"));
    await rename(join(missingPackage, "dist", "commands", "du", "index.js"), join(missingPackage, "dist", "commands", "du", "index.js.disabled"));
    await failure(await save("negative-missing-du", await run(process.execPath, [join(taskRoot, "harness", "verify-v5.mjs"), missingPackage, scratch], { cwd: missingConsumer })), "missing installed DU guard");

    const mutantConsumer = join(scratch, "negative-restored-cleanup");
    await guardedCopy(movedConsumer, mutantConsumer, "restored-cleanup-consumer");
    const mutantPackage = await realpath(join(mutantConsumer, "node_modules", "virtual-bash"));
    const overlayPath = join(mutantPackage, "dist", "fs", "overlay", "index.js");
    const overlayText = await readFile(overlayPath, "utf8");
    const pureLine = "return this.run(options, async () => this.listing(await this.required(path, options), options), false);";
    if (!overlayText.includes(pureLine)) throw new Error("restored cleanup mutant target missing");
    await writeFile(overlayPath, overlayText.replace(pureLine, "return this.run(options, async () => this.listing(await this.required(path, options), options));"));
    await failure(await save("negative-restored-cleanup-v5", await run(process.execPath, [join(taskRoot, "harness", "verify-v5.mjs"), mutantPackage, scratch], { cwd: mutantConsumer })), "restored cleanup behavior mutant");

    const typeConsumer = join(scratch, "negative-semantic-declaration");
    await guardedCopy(movedConsumer, typeConsumer, "semantic-declaration-consumer");
    const declaration = join(typeConsumer, "node_modules", "virtual-bash", "dist", "commands", "du", "index.d.ts");
    await writeFile(declaration, `${await readFile(declaration, "utf8")}\nexport declare const __v5SemanticDeclarationControl: __V5MissingDeclaredType;\n`);
    const badTypes = await failure(await save("negative-semantic-declaration", await run(tsc, ["-p", join(typeConsumer, "tsconfig.json")], { cwd: typeConsumer })), "semantic undeclared-type control");
    if (!/Cannot find name '__V5MissingDeclaredType'|TS2304/u.test(badTypes.stdout.toString() + badTypes.stderr.toString())) throw new Error("declaration control failed for an unexpected reason");

    const nativeOutput = join(evidence, "native-environment-table.json");
    await save("native-environment-table", await success(await run(process.execPath, [join(taskRoot, "native-env.mjs"), nativeDu, nativeOutput, join(scratch, "native")]), "native environment table"));

    const inputsAfter = await inventory(source, new Set(["dist"]));
    if (JSON.stringify(inputsBefore) !== JSON.stringify(inputsAfter)) throw new Error("candidate selected inputs changed or gained entries outside dist");
    await writeFile(join(evidence, "candidate-inputs-after.json"), json(inputsAfter), { flag: "wx" });
    const indexAfter = await run("git", ["diff", "--cached", "--binary"]);
    const manifest = {
      schema: 1,
      startedAt,
      finishedAt: new Date().toISOString(),
      invocation: { argv: process.argv, cwd: process.cwd() },
      freezeCommit,
      candidate,
      frozenManifestSha256: sha256(freeze.bytes),
      tools: toolIdentities,
      candidateArchive: { selectedFileCount: selected.length, sha256: sha256(await readFile(archive)), preArchiveAdmission: true, preExtractionAdmission: true, appendCheckedAfterRun: true },
      npmPackage: { tarballSha256: sha256(await readFile(tarball)), completeFileCount: packedInventory.length, completeInstalledHashesMatch: true, preExtractionAdmission: true, productionDependencies: productPackage.dependencies ?? {}, productionDependencyCount: 0 },
      suites: { originalSource: sourceOriginalJson.summary, originalMoved: packageRuns.original.summary, v5Source: sourceV5Json.summary, v5Moved: packageRuns.v5.summary, sameSourceAndMovedProjections: true },
      scopedRegressions: { exactFiles: regressionFiles, status: 0, unrelatedAuthorCohortsNotSummed: true },
      negativeControls: { wrongRoot: wrongRoot.status, missingDu: "failed-as-required", restoredCleanup: "failed-unchanged-assertions", semanticDeclaration: badTypes.status, agentsAdmission: executableNegativeAdmissionControl() },
      native: { scope: "single-file apparent-size environment precedence only", broadParityClaimed: false, output: "native-environment-table.json" },
      indexFingerprint: { before: indexBeforeSha256, after: sha256(indexAfter.stdout), unchanged: indexBeforeSha256 === sha256(indexAfter.stdout) },
      closure: { spawnedChildPids: allChildPids, activeChildren: [...activeChildren], workersOrSubagentsCreated: 0, scratchUnderOwnedResult: scratch.startsWith(`${resultDirectory}/work-`) },
      steps,
    };
    if (!manifest.indexFingerprint.unchanged || manifest.closure.activeChildren.length) throw new Error("closure or foreign index fingerprint check failed");
    await writeFile(join(evidence, "RESULTS.json"), json(manifest), { flag: "wx" });
    await rm(scratch, { recursive: true, force: true });
    await writeFile(join(evidence, "SCRATCH-CLOSED.json"), json({ removed: true, path: scratch, activeChildren: [...activeChildren] }), { flag: "wx" });
    process.stdout.write(`${evidence}\n`);
  } catch (error) {
    protocolError = error;
    await writeFile(join(evidence, "PROTOCOL-ERROR.txt"), `${error.stack ?? error}\n`, { flag: "wx" });
    await writeFile(join(evidence, "FAILED-CLOSURE.json"), json({ at: new Date().toISOString(), activeChildren: [...activeChildren], scratchRetained: scratch }), { flag: "wx" });
    process.stderr.write(`${error.stack ?? error}\nFailed evidence retained at ${evidence}\n`);
  }
  if (protocolError) process.exitCode = 1;
}
