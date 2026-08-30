import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseline = "877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3";
const requested = process.argv[2] ?? baseline;
if (!/^[0-9a-f]{40}$/u.test(requested)) {
  throw new Error("capture requires an exact 40-character lowercase Git commit hash; mutable names are refused");
}
const taskRoot = dirname(fileURLToPath(import.meta.url));
const repository = resolve(taskRoot, "../../..");
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
  "HOLDOUT_CONTRACT.md", "capture.mjs", "verify.mjs",
  "consumer/package.json", "consumer/tsconfig.json", "consumer/consumer.ts", "consumer/consumer.mjs",
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
    const stdout = [], stderr = [];
    child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
    child.on("error", rejectPromise);
    child.on("close", (status, signal) => {
      activeChildren.delete(child.pid);
      resolvePromise({ command, args, status, signal,
        stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    if (options.input === undefined) child.stdin.end();
    else child.stdin.end(options.input);
  });
}

async function requireSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${result.stderr.toString()}`);
  }
  return result;
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
      } else if (entry.isSymbolicLink()) {
        throw new Error(`unexpected symlink in authenticated input tree: ${local}`);
      } else throw new Error(`unexpected input entry: ${local}`);
    }
  };
  await visit(root);
  return answer.sort((left, right) => left.path.localeCompare(right.path));
}

async function saveStep(evidence, name, result) {
  await writeFile(join(evidence, `${name}.stdout.txt`), result.stdout);
  await writeFile(join(evidence, `${name}.stderr.txt`), result.stderr);
  return { name, command: result.command, args: result.args, status: result.status, signal: result.signal,
    stdoutBytes: result.stdout.byteLength, stderrBytes: result.stderr.byteLength };
}

await requireSuccess(await run("git", ["rev-parse", "--show-toplevel"]), "git root");
const resolvedResult = await requireSuccess(await run("git", ["rev-parse", `${requested}^{commit}`]), "resolve revision");
const revision = resolvedResult.stdout.toString().trim();
const rootResult = await requireSuccess(await run("git", ["rev-parse", "--show-toplevel"]), "git root");
if (await realpath(rootResult.stdout.toString().trim()) !== await realpath(repository)) throw new Error("wrong repository root");

await mkdir(join(taskRoot, ".scratch"), { recursive: true });
await mkdir(join(taskRoot, "evidence"), { recursive: true });
const scratch = await mkdtemp(join(taskRoot, ".scratch", `${revision.slice(0, 8)}-`));
const startedAt = new Date().toISOString();
const stamp = startedAt.replaceAll(":", "").replaceAll(".", "");
const captureKind = revision === baseline ? "baseline" : "supplied-revision";
const evidence = await mkdtemp(join(taskRoot, "evidence", `${captureKind}-${revision.slice(0, 8)}-${stamp}-${randomBytes(2).toString("hex")}-`));
const archiveRoot = join(scratch, "committed");
const archiveTar = join(scratch, "committed-inputs.tar");
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
  const startIndex = await run("git", ["diff", "--cached", "--binary"]);
  const startIndexHash = await requireSuccess(await run("git", ["hash-object", "--stdin"], { input: startIndex.stdout }), "start index fingerprint");
  await mkdir(archiveRoot);
  const tree = await requireSuccess(await run("git", ["ls-tree", "-r", revision, "--", ...selectedInputs]), "git tree inventory");
  await writeFile(join(evidence, "git-tree.txt"), tree.stdout);
  const archive = await run("git", ["archive", "--format=tar", `--output=${archiveTar}`, revision, "--", ...selectedInputs]);
  steps.push(await saveStep(evidence, "git-archive", archive));
  await requireSuccess(archive, "git archive");
  const archiveSha256 = sha256(await readFile(archiveTar));
  const extract = await run("tar", ["-x", "-f", archiveTar, "-C", archiveRoot]);
  steps.push(await saveStep(evidence, "extract", extract));
  await requireSuccess(extract, "extract archive");
  const forbiddenAgents = (await inventory(archiveRoot)).filter(item => item.path.endsWith("AGENTS.md"));
  if (forbiddenAgents.length) throw new Error("archive unexpectedly contains AGENTS.md");
  const inputsBefore = await inventory(archiveRoot);
  await writeFile(join(evidence, "inputs-before.json"), json(inputsBefore));
  const relevantSourceHashes = Object.fromEntries([
    "src/fs/overlay/index.ts", "src/commands/du/arguments.ts",
    "src/commands/du/du.ts", "src/commands/du/index.ts",
  ].map(path => [path, inputsBefore.find(item => item.path === path)?.sha256]));

  const build = await run(join(repository, "node_modules", ".bin", "tsc"), ["-p", join(archiveRoot, "tsconfig.build.json")]);
  steps.push(await saveStep(evidence, "build", build));
  await requireSuccess(build, "committed source build");

  const verify = await run(process.execPath, [join(taskRoot, "verify.mjs"), archiveRoot]);
  steps.push(await saveStep(evidence, "holdouts", verify));
  let verification;
  try { verification = JSON.parse(verify.stdout.toString()); }
  catch (cause) { throw new Error("holdout verifier did not emit JSON", { cause }); }
  await writeFile(join(evidence, "holdouts.json"), json(verification));

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
  await requireSuccess(pack, "npm pack");
  const packRecord = JSON.parse(pack.stdout.toString())[0];
  const tarball = join(scratch, packRecord.filename);
  const tarballSha256 = sha256(await readFile(tarball));

  const consumerRoot = join(scratch, "relocated", "consumer");
  await mkdir(dirname(consumerRoot), { recursive: true });
  await cp(join(taskRoot, "consumer"), consumerRoot, { recursive: true });
  const install = await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-save", "--package-lock=false", tarball], { cwd: consumerRoot, env: npmEnv });
  steps.push(await saveStep(evidence, "consumer-install", install));
  await requireSuccess(install, "moved consumer install");
  const typecheck = await run(join(repository, "node_modules", ".bin", "tsc"), ["-p", join(consumerRoot, "tsconfig.json")], { cwd: consumerRoot });
  steps.push(await saveStep(evidence, "consumer-typecheck", typecheck));
  await requireSuccess(typecheck, "strict moved consumer typecheck");
  const consumer = await run(process.execPath, [join(consumerRoot, "consumer.mjs")], { cwd: consumerRoot });
  steps.push(await saveStep(evidence, "consumer-runtime", consumer));
  await requireSuccess(consumer, "moved consumer runtime");
  const packageProof = JSON.parse(consumer.stdout.toString());
  await writeFile(join(evidence, "package-proof.json"), json(packageProof));
  const builtDuSha256 = sha256(await readFile(join(archiveRoot, "dist", "commands", "du", "index.js")));
  const builtRootSha256 = sha256(await readFile(join(archiveRoot, "dist", "index.js")));
  if (packageProof.duSha256 !== builtDuSha256 || packageProof.rootSha256 !== builtRootSha256) {
    throw new Error("installed consumer loaded bytes other than the authenticated committed build");
  }

  const inputsAfter = await inventory(archiveRoot, new Set(["dist"]));
  await writeFile(join(evidence, "inputs-after.json"), json(inputsAfter));
  const immutableInputs = JSON.stringify(inputsBefore) === JSON.stringify(inputsAfter);
  if (!immutableInputs) throw new Error("committed input archive changed or gained entries");
  const harnessAfter = [];
  for (const path of harnessInputs) {
    const bytes = await readFile(join(taskRoot, path));
    harnessAfter.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const immutableHarness = JSON.stringify(harnessBefore) === JSON.stringify(harnessAfter);
  if (!immutableHarness) throw new Error("holdout harness changed during capture");

  const index = await run("git", ["diff", "--cached", "--binary"]);
  const indexHash = await requireSuccess(await run("git", ["hash-object", "--stdin"], { input: index.stdout }), "index fingerprint");
  const versions = {};
  for (const [name, command, args] of [
    ["node", process.execPath, ["--version"]], ["npm", "npm", ["--version"]],
    ["typescript", join(repository, "node_modules", ".bin", "tsc"), ["--version"]],
    ["tsx", process.execPath, ["--input-type=module", "--import", "tsx", "-e", "console.log((await import('tsx/package.json',{with:{type:'json'}})).default.version)"]],
  ]) {
    const result = await requireSuccess(await run(command, args), `${name} version`);
    versions[name] = result.stdout.toString().trim();
  }

  const expectedBaselineReds = new Set([
    "pending direct readdir is pure",
    "pending direct DU traversal is pure",
    "pending readonly wrapper readdir is pure",
    "pending readonly wrapper DU traversal is pure",
    "pending mount over overlay readdir is pure",
    "pending mount over overlay DU traversal is pure",
    "pending overlay over mount readdir is pure",
    "pending overlay over mount du is pure",
    "metadata failure and retry preserve pending state",
    "mid-traversal cancellation is pure",
    "invalid selected DU_BLOCK_SIZE falls back to no-env default",
    "empty selected DU_BLOCK_SIZE falls back to no-env default",
  ]);
  const actualReds = new Set(verification.results.filter(result => !result.pass).map(result => result.name));
  const baselinePattern = revision !== baseline ? undefined
    : actualReds.size === expectedBaselineReds.size
      && [...expectedBaselineReds].every(name => actualReds.has(name))
      && verification.summary.controls.failed === 0
      && verify.status !== 0;
  if (revision === baseline && !baselinePattern) throw new Error("baseline did not reproduce the frozen RED pattern");

  const manifest = {
    schema: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    requestedRevision: requested,
    revision,
    knownBaseline: baseline,
    purpose: revision === baseline ? "authenticated pre-candidate baseline" : "explicit supplied revision",
    archive: { selectedInputs, sha256: archiveSha256, gitTreeFile: "git-tree.txt" },
    harness: { inputs: harnessBefore, immutableDuringCapture: immutableHarness, snapshots: "harness/" },
    immutableInputs,
    postRunDetectsNewEntries: "yes, for the selected extracted input tree excluding generated dist",
    inputCount: inputsBefore.length,
    relevantSourceHashes,
    outputHashes: { builtDuSha256, builtRootSha256, tarballSha256 },
    packageProof: {
      packageRoot: packageProof.packageRoot,
      rootPath: packageProof.rootPath,
      duPath: packageProof.duPath,
      resolvedInsideInstalledPackage: true,
      hashesMatchAuthenticatedBuild: true,
    },
    verification: { processStatus: verify.status, summary: verification.summary, baselinePattern },
    scopedRegressionsStatus: regressions.status,
    consumer: { installStatus: install.status, strictTypecheckStatus: typecheck.status, runtimeStatus: consumer.status },
    versions,
    steps,
    foreignIndexFingerprintAtStart: startIndexHash.stdout.toString().trim(),
    foreignIndexFingerprintAtFinish: indexHash.stdout.toString().trim(),
    childrenAtFinish: [...activeChildren],
    noSubagentsOrWorkersCreated: true,
  };
  await writeFile(join(evidence, "manifest.json"), json(manifest));
  process.stdout.write(`${evidence}\n`);
} catch (error) {
  protocolError = error;
  await writeFile(join(evidence, "PROTOCOL-ERROR.txt"), `${error.stack ?? error}\n`);
  process.stderr.write(`${error.stack ?? error}\nEvidence retained at ${evidence}\n`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}

if (activeChildren.size) throw new Error(`child processes still active: ${[...activeChildren].join(",")}`);
if (protocolError) process.exitCode = 1;
