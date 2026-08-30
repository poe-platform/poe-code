import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const candidate = "9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d";
const requested = process.argv[2] ?? candidate;
if (requested !== candidate) throw new Error(`this verifier is bound to exact candidate ${candidate}`);
const taskRoot = dirname(fileURLToPath(import.meta.url));
const repository = resolve(taskRoot, "../../../..");
const activeChildren = new Set();
const selectedInputs = [
  "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "src",
  "tests/commands/du/backends.test.ts",
  "tests/commands/du/behavior.test.ts",
  "tests/commands/du/helpers.ts",
  "tests/fs/overlay/allocation.test.ts",
  "tests/fs/overlay/allocation-evidence/README.md",
  "tests/fs/overlay/adversarial.test.ts",
  "tests/fs/overlay/helpers.ts",
  "tests/fs/webdav/mock.ts",
];
const harnessInputs = [
  "capture-candidate.mjs",
  "capture-original.mjs",
  "FIXTURE_CORRECTION_V3.md",
  "harness/HOLDOUT_CONTRACT.md",
  "harness/HOLDOUT_REFINEMENT_V2.md",
  "harness/verify-original.mjs",
  "harness/verify-refined-v2.mjs",
  "harness/capture-command.mjs",
  "harness/attest-loader.mjs",
  "harness/consumer-v2/package.json",
  "harness/consumer-v2/tsconfig.json",
  "harness/consumer-v2/consumer.ts",
  "harness/consumer-v2/runtime.mjs",
];

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => `${JSON.stringify(value, null, 2)}\n`;

async function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repository,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    activeChildren.add(child.pid);
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

async function requireSuccess(result, label) {
  if (result.status !== 0) throw new Error(`${label} failed (${result.status}): ${result.stderr.toString()}`);
  return result;
}

async function requireFailure(result, label) {
  if (result.status === 0) throw new Error(`${label} unexpectedly passed`);
  return result;
}

async function saveStep(evidence, name, result) {
  await writeFile(join(evidence, `${name}.stdout.txt`), result.stdout);
  await writeFile(join(evidence, `${name}.stderr.txt`), result.stderr);
  const record = {
    name, command: result.command, args: result.args, status: result.status, signal: result.signal,
    stdoutBytes: result.stdout.byteLength, stderrBytes: result.stderr.byteLength,
    stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr),
  };
  await writeFile(join(evidence, `${name}.step.json`), json(record));
  return record;
}

async function inventory(root, exclusions = new Set()) {
  const answer = [];
  const visit = async path => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name);
      const local = relative(root, absolute).replaceAll("\\", "/");
      if (exclusions.has(local.split("/")[0])) continue;
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        const bytes = await readFile(absolute);
        answer.push({ path: local, bytes: bytes.byteLength, sha256: sha256(bytes) });
      } else if (entry.isSymbolicLink()) throw new Error(`unexpected symlink in authenticated tree: ${local}`);
      else throw new Error(`unexpected entry in authenticated tree: ${local}`);
    }
  };
  await visit(root);
  return answer.sort((left, right) => left.path.localeCompare(right.path));
}

function parsed(result, label) {
  try { return JSON.parse(result.stdout.toString()); }
  catch (cause) { throw new Error(`${label} did not emit JSON`, { cause }); }
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

function originalProjection(document) {
  return canonicalize({ summary: document.summary, results: document.results });
}

async function parseLoaderLog(path) {
  const text = await readFile(path, "utf8");
  return text.split("\n").filter(Boolean).map(line => JSON.parse(line));
}

await requireSuccess(await run("git", ["rev-parse", "--show-toplevel"]), "git root");
const resolved = (await requireSuccess(await run("git", ["rev-parse", `${requested}^{commit}`]), "candidate resolution")).stdout.toString().trim();
if (resolved !== candidate) throw new Error("candidate resolution changed");
if (await realpath(repository) !== await realpath((await requireSuccess(await run("git", ["rev-parse", "--show-toplevel"]), "git root")).stdout.toString().trim())) {
  throw new Error("wrong Git repository root");
}

await mkdir(join(taskRoot, ".scratch"), { recursive: true });
await mkdir(join(taskRoot, "evidence"), { recursive: true });
const scratch = await mkdtemp(join(taskRoot, ".scratch", "candidate-capture-"));
const startedAt = new Date().toISOString();
const evidence = await mkdtemp(join(taskRoot, "evidence", `candidate-${candidate.slice(0, 8)}-${startedAt.replaceAll(":", "").replaceAll(".", "")}-${randomBytes(2).toString("hex")}-`));
const archiveTar = join(scratch, "candidate-selected.tar");
const archiveRoot = join(scratch, "committed");
const steps = [];
let protocolError;

try {
  const harnessBefore = [];
  for (const path of harnessInputs) {
    const bytes = await readFile(join(taskRoot, path));
    harnessBefore.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
    const destination = join(evidence, "harness", path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  const foreignIndexBefore = await run("git", ["diff", "--cached", "--binary"]);
  const foreignIndexHashBefore = (await requireSuccess(await run("git", ["hash-object", "--stdin"], { input: foreignIndexBefore.stdout }), "index fingerprint before")).stdout.toString().trim();

  await mkdir(archiveRoot);
  const tree = await requireSuccess(await run("git", ["ls-tree", "-r", candidate, "--", ...selectedInputs]), "selected Git tree");
  await writeFile(join(evidence, "git-tree.txt"), tree.stdout);
  const archive = await run("git", ["archive", "--format=tar", `--output=${archiveTar}`, candidate, "--", ...selectedInputs]);
  steps.push(await saveStep(evidence, "git-archive", archive));
  await requireSuccess(archive, "candidate archive");
  const archiveSha256 = sha256(await readFile(archiveTar));
  const extract = await run("tar", ["-xf", archiveTar, "-C", archiveRoot]);
  steps.push(await saveStep(evidence, "extract", extract));
  await requireSuccess(extract, "candidate archive extraction");
  const inputsBefore = await inventory(archiveRoot);
  if (inputsBefore.some(item => item.path.endsWith("AGENTS.md"))) throw new Error("selected archive contains AGENTS.md");
  await writeFile(join(evidence, "inputs-before.json"), json(inputsBefore));
  const relevantSourceHashes = Object.fromEntries([
    "src/fs/overlay/index.ts",
    "src/commands/du/arguments.ts",
    "src/commands/du/du.ts",
    "src/commands/du/index.ts",
  ].map(path => [path, inputsBefore.find(item => item.path === path)?.sha256]));

  const tsc = join(repository, "node_modules", ".bin", "tsc");
  const build = await run(tsc, ["-p", join(archiveRoot, "tsconfig.build.json")]);
  steps.push(await saveStep(evidence, "build", build));
  await requireSuccess(build, "isolated candidate build");

  const originalSourceRun = await run(process.execPath, [join(taskRoot, "harness", "verify-original.mjs"), archiveRoot]);
  steps.push(await saveStep(evidence, "source-original", originalSourceRun));
  await requireSuccess(originalSourceRun, "source original holdouts");
  const originalSource = parsed(originalSourceRun, "source original holdouts");
  await writeFile(join(evidence, "source-original.json"), json(originalSource));

  const refinedSourceRun = await run(process.execPath, [join(taskRoot, "harness", "verify-refined-v2.mjs"), archiveRoot]);
  steps.push(await saveStep(evidence, "source-refined-v3", refinedSourceRun));
  await requireSuccess(refinedSourceRun, "source refined holdouts");
  const refinedSource = parsed(refinedSourceRun, "source refined holdouts");
  await writeFile(join(evidence, "source-refined-v3.json"), json(refinedSource));

  const regressionFiles = [
    "tests/commands/du/behavior.test.ts",
    "tests/commands/du/backends.test.ts",
    "tests/fs/overlay/allocation.test.ts",
    "tests/fs/overlay/adversarial.test.ts",
  ];
  const regressions = await run(process.execPath, ["--import", "tsx", "--test", ...regressionFiles], { cwd: archiveRoot });
  steps.push(await saveStep(evidence, "scoped-regressions", regressions));
  await requireSuccess(regressions, "scoped regressions");

  const npmEnv = {
    ...process.env,
    npm_config_cache: join(scratch, "npm-cache"),
    npm_config_userconfig: "/dev/null",
    npm_config_update_notifier: "false",
  };
  const pack = await run("npm", ["pack", "--json", "--pack-destination", scratch], { cwd: archiveRoot, env: npmEnv });
  steps.push(await saveStep(evidence, "npm-pack", pack));
  await requireSuccess(pack, "candidate npm pack");
  const packRecord = JSON.parse(pack.stdout.toString())[0];
  await writeFile(join(evidence, "npm-pack-record.json"), json(packRecord));
  const tarball = join(scratch, packRecord.filename);
  const tarballSha256 = sha256(await readFile(tarball));
  const tarList = await run("tar", ["-tvf", tarball]);
  steps.push(await saveStep(evidence, "npm-tar-list", tarList));
  await requireSuccess(tarList, "tarball list");
  const unpacked = join(scratch, "unpacked");
  await mkdir(unpacked);
  const unpack = await run("tar", ["-xzf", tarball, "-C", unpacked]);
  steps.push(await saveStep(evidence, "npm-tar-extract", unpack));
  await requireSuccess(unpack, "tarball extract");
  const packedInventory = await inventory(join(unpacked, "package"));
  await writeFile(join(evidence, "packed-files.json"), json(packedInventory));

  const stagingConsumer = join(scratch, "install-staging", "consumer");
  await mkdir(dirname(stagingConsumer), { recursive: true });
  await cp(join(taskRoot, "harness", "consumer-v2"), stagingConsumer, { recursive: true });
  const install = await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-save", "--package-lock=false", tarball], { cwd: stagingConsumer, env: npmEnv });
  steps.push(await saveStep(evidence, "consumer-install-before-move", install));
  await requireSuccess(install, "consumer install");
  const movedConsumer = join(scratch, "relocated-after-install", "moved-consumer");
  await mkdir(dirname(movedConsumer), { recursive: true });
  await rename(stagingConsumer, movedConsumer);
  const installedPackage = await realpath(join(movedConsumer, "node_modules", "virtual-bash"));
  const installedInventory = await inventory(installedPackage);
  await writeFile(join(evidence, "installed-files.json"), json(installedInventory));
  if (JSON.stringify(packedInventory) !== JSON.stringify(installedInventory)) throw new Error("moved installed package differs from tarball complete file inventory");

  const consumerTypes = await run(tsc, ["-p", join(movedConsumer, "tsconfig.json")], { cwd: movedConsumer });
  steps.push(await saveStep(evidence, "consumer-strict-types", consumerTypes));
  await requireSuccess(consumerTypes, "strict NodeNext moved consumer");
  const consumerRuntime = await run(process.execPath, [join(movedConsumer, "runtime.mjs")], { cwd: movedConsumer });
  steps.push(await saveStep(evidence, "consumer-runtime", consumerRuntime));
  await requireSuccess(consumerRuntime, "moved consumer runtime");
  const runtimeProof = parsed(consumerRuntime, "moved consumer runtime");
  await writeFile(join(evidence, "consumer-runtime.json"), json(runtimeProof));

  const loader = join(taskRoot, "harness", "attest-loader.mjs");
  const originalLoadLog = join(evidence, "package-original-loads.jsonl");
  const packageEnvOriginal = { ...process.env, DU_OVERLAY_ATTEST_LOG: originalLoadLog, DU_OVERLAY_EXPECTED_MODULE_ROOT: installedPackage };
  const originalPackageRun = await run(process.execPath, ["--experimental-loader", loader, join(taskRoot, "harness", "verify-original.mjs"), installedPackage], { cwd: movedConsumer, env: packageEnvOriginal });
  steps.push(await saveStep(evidence, "package-original", originalPackageRun));
  await requireSuccess(originalPackageRun, "moved package original holdouts");
  const originalPackage = parsed(originalPackageRun, "moved package original holdouts");
  await writeFile(join(evidence, "package-original.json"), json(originalPackage));

  const refinedLoadLog = join(evidence, "package-refined-loads.jsonl");
  const packageEnvRefined = { ...process.env, DU_OVERLAY_ATTEST_LOG: refinedLoadLog, DU_OVERLAY_EXPECTED_MODULE_ROOT: installedPackage };
  const refinedPackageRun = await run(process.execPath, ["--experimental-loader", loader, join(taskRoot, "harness", "verify-refined-v2.mjs"), installedPackage], { cwd: movedConsumer, env: packageEnvRefined });
  steps.push(await saveStep(evidence, "package-refined-v3", refinedPackageRun));
  await requireSuccess(refinedPackageRun, "moved package refined holdouts");
  const refinedPackage = parsed(refinedPackageRun, "moved package refined holdouts");
  await writeFile(join(evidence, "package-refined-v3.json"), json(refinedPackage));

  const sourcePackageParity = {
    original: JSON.stringify(originalProjection(originalSource)) === JSON.stringify(originalProjection(originalPackage)),
    refined: JSON.stringify(refinedSource.parityProjection) === JSON.stringify(refinedPackage.parityProjection),
  };
  if (!sourcePackageParity.original || !sourcePackageParity.refined) throw new Error("source and moved-package target outputs differ");

  const loadRecords = [...await parseLoaderLog(originalLoadLog), ...await parseLoaderLog(refinedLoadLog)];
  const packageLoadRecords = loadRecords.filter(record => record.path.startsWith(`${installedPackage}/dist/`));
  if (!packageLoadRecords.length) throw new Error("loader did not attest package dist loads");
  for (const record of packageLoadRecords) {
    if (!record.sourceSha256) throw new Error(`loader provided no source bytes for ${record.path}`);
    if (record.sourceSha256 !== sha256(await readFile(record.path))) throw new Error(`loader source hash differs from disk for ${record.path}`);
  }
  for (const required of ["dist/commands/du/index.js", "dist/fs/overlay/index.js"]) {
    if (!packageLoadRecords.some(record => record.path === join(installedPackage, required))) throw new Error(`required package load not attested: ${required}`);
  }
  const loadProof = {
    expectedPackageRoot: installedPackage,
    records: packageLoadRecords.length,
    uniquePaths: [...new Set(packageLoadRecords.map(record => record.path))].sort(),
    everyPathInsideMovedPackage: packageLoadRecords.every(record => record.path.startsWith(`${installedPackage}/dist/`)),
    everyNextLoadSourceHashMatchesDisk: true,
  };
  await writeFile(join(evidence, "package-load-proof.json"), json(loadProof));

  const wrongLoadLog = join(evidence, "negative-wrong-root-loads.jsonl");
  const wrongRoot = await run(process.execPath, ["--experimental-loader", loader, join(taskRoot, "harness", "verify-refined-v2.mjs"), archiveRoot], {
    cwd: movedConsumer,
    env: { ...process.env, DU_OVERLAY_ATTEST_LOG: wrongLoadLog, DU_OVERLAY_EXPECTED_MODULE_ROOT: installedPackage },
  });
  steps.push(await saveStep(evidence, "negative-wrong-root", wrongRoot));
  await requireFailure(wrongRoot, "wrong-package/source-fallback negative control");

  const missingConsumer = join(scratch, "negative-missing-du", "consumer");
  await mkdir(dirname(missingConsumer), { recursive: true });
  await cp(movedConsumer, missingConsumer, { recursive: true });
  const missingPackage = await realpath(join(missingConsumer, "node_modules", "virtual-bash"));
  await rename(join(missingPackage, "dist", "commands", "du", "index.js"), join(missingPackage, "dist", "commands", "du", "index.js.disabled"));
  const missingDu = await run(process.execPath, [join(taskRoot, "harness", "verify-refined-v2.mjs"), missingPackage], { cwd: missingConsumer });
  steps.push(await saveStep(evidence, "negative-missing-installed-du", missingDu));
  await requireFailure(missingDu, "installed DU missing/fallback denial control");

  const behaviorConsumer = join(scratch, "negative-overlay-behavior", "consumer");
  await mkdir(dirname(behaviorConsumer), { recursive: true });
  await cp(movedConsumer, behaviorConsumer, { recursive: true });
  const behaviorPackage = await realpath(join(behaviorConsumer, "node_modules", "virtual-bash"));
  const overlayPath = join(behaviorPackage, "dist", "fs", "overlay", "index.js");
  const overlayText = await readFile(overlayPath, "utf8");
  const pureLine = "return this.run(options, async () => this.listing(await this.required(path, options), options), false);";
  if (!overlayText.includes(pureLine)) throw new Error("behavior mutant could not find candidate readdir implementation");
  await writeFile(overlayPath, overlayText.replace(pureLine, "return this.run(options, async () => this.listing(await this.required(path, options), options));"));
  const mutantOriginal = await run(process.execPath, [join(taskRoot, "harness", "verify-original.mjs"), behaviorPackage], { cwd: behaviorConsumer });
  steps.push(await saveStep(evidence, "negative-behavior-original", mutantOriginal));
  await requireFailure(mutantOriginal, "overlay behavior mutant original assertions");
  const mutantRefined = await run(process.execPath, [join(taskRoot, "harness", "verify-refined-v2.mjs"), behaviorPackage], { cwd: behaviorConsumer });
  steps.push(await saveStep(evidence, "negative-behavior-refined", mutantRefined));
  await requireFailure(mutantRefined, "overlay behavior mutant refined assertions");

  const invalidTypesConsumer = join(scratch, "negative-invalid-declaration", "consumer");
  await mkdir(dirname(invalidTypesConsumer), { recursive: true });
  await cp(movedConsumer, invalidTypesConsumer, { recursive: true });
  const invalidDeclaration = join(invalidTypesConsumer, "node_modules", "virtual-bash", "dist", "commands", "du", "index.d.ts");
  await writeFile(invalidDeclaration, `${await readFile(invalidDeclaration, "utf8")}\nexport type __IndependentInvalidDeclaration = ;\n`);
  const invalidTypes = await run(tsc, ["-p", join(invalidTypesConsumer, "tsconfig.json")], { cwd: invalidTypesConsumer });
  steps.push(await saveStep(evidence, "negative-invalid-declaration", invalidTypes));
  await requireFailure(invalidTypes, "invalid declaration strict-type control");

  const inputsAfter = await inventory(archiveRoot, new Set(["dist"]));
  await writeFile(join(evidence, "inputs-after.json"), json(inputsAfter));
  if (JSON.stringify(inputsBefore) !== JSON.stringify(inputsAfter)) throw new Error("committed archive inputs changed or gained entries");
  const harnessAfter = [];
  for (const path of harnessInputs) {
    const bytes = await readFile(join(taskRoot, path));
    harnessAfter.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  if (JSON.stringify(harnessBefore) !== JSON.stringify(harnessAfter)) throw new Error("harness changed during capture");

  const foreignIndexAfter = await run("git", ["diff", "--cached", "--binary"]);
  const foreignIndexHashAfter = (await requireSuccess(await run("git", ["hash-object", "--stdin"], { input: foreignIndexAfter.stdout }), "index fingerprint after")).stdout.toString().trim();
  const versions = {};
  for (const [name, command, args] of [
    ["node", process.execPath, ["--version"]],
    ["npm", "npm", ["--version"]],
    ["typescript", tsc, ["--version"]],
  ]) versions[name] = (await requireSuccess(await run(command, args), `${name} version`)).stdout.toString().trim();

  const builtDuSha256 = sha256(await readFile(join(archiveRoot, "dist", "commands", "du", "index.js")));
  const builtOverlaySha256 = sha256(await readFile(join(archiveRoot, "dist", "fs", "overlay", "index.js")));
  if (runtimeProof.duSha256 !== builtDuSha256) throw new Error("moved runtime DU differs from authenticated build");
  const manifest = {
    schema: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    exactCandidate: candidate,
    freezeCommits: {
      initial: "510c621e1dfa8f7ffba1d796f5f7e55d967368e2",
      refinedV2: "8c28d7c848311372cbef5ec3e4facff546baf0a8",
      baselineEvidence: "82e97559330cff52f63f22c7d5fd80185fe65f44",
      handoff: "87833f33cb7fa6d2a6c098201dd53fe5404a7fcb",
      combinedCandidateEvidence: "c5fe1a68",
    },
    archive: { selectedInputs, inputCount: inputsBefore.length, sha256: archiveSha256, postRunDetectsNewEntries: true, immutableAfterRun: true },
    relevantSourceHashes,
    outputHashes: { builtDuSha256, builtOverlaySha256, tarballSha256 },
    originalReplay: { source: originalSource.summary, movedPackage: originalPackage.summary, parity: sourcePackageParity.original },
    refinedReplay: { source: refinedSource.summary, movedPackage: refinedPackage.summary, parity: sourcePackageParity.refined },
    scopedRegressionsStatus: regressions.status,
    package: {
      installedThenMoved: true,
      movedConsumer,
      installedPackage,
      completeFileCount: installedInventory.length,
      completeHashesMatchTarball: true,
      loadProof,
      runtimeProof,
    },
    strictTypes: { status: consumerTypes.status, skipLibCheck: false, invalidDeclarationControlStatus: invalidTypes.status },
    executableNegativeControls: {
      wrongRootStatus: wrongRoot.status,
      missingInstalledDuStatus: missingDu.status,
      behaviorMutantOriginalStatus: mutantOriginal.status,
      behaviorMutantRefinedStatus: mutantRefined.status,
      invalidDeclarationStatus: invalidTypes.status,
    },
    harness: { immutableDuringCapture: true, inputs: harnessBefore },
    foreignIndexFingerprintAtStart: foreignIndexHashBefore,
    foreignIndexFingerprintAtFinish: foreignIndexHashAfter,
    childrenAtFinish: [...activeChildren],
    workersOrSubagentsCreated: 0,
    versions,
    steps,
  };
  await writeFile(join(evidence, "manifest.json"), json(manifest));
  process.stdout.write(`${evidence}\n`);
} catch (error) {
  protocolError = error;
  await writeFile(join(evidence, "PROTOCOL-ERROR.txt"), `${error.stack ?? error}\n`);
  process.stderr.write(`${error.stack ?? error}\nEvidence retained at ${evidence}\n`);
} finally {
  const authenticatedScratch = await realpath(scratch);
  const authenticatedTaskScratch = await realpath(join(taskRoot, ".scratch"));
  if (!authenticatedScratch.startsWith(`${authenticatedTaskScratch}/candidate-capture-`)) throw new Error("refusing scratch cleanup outside authenticated task root");
  await rm(authenticatedScratch, { recursive: true, force: true });
}

if (activeChildren.size) throw new Error(`child processes remain active: ${[...activeChildren].join(",")}`);
if (protocolError) process.exitCode = 1;
