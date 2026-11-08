import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const baseline = "5137a74ec855a32d8a8860eb66b62eb44d11e290";
const sourcePath = "src/commands/structured/interpreter.ts";
const baselineBlob = "f7e0dfcb1815aa90ae49d495e453b4d069139108";
const baselineSha256 = "bac1cf5325eff5bfa69f1c8bec5d3d8a80bb452fd61cdc802d55a26788acaffc";
const oldArm = '      else if (typeof input === "string") yield Array.from(input).length;';
const candidateArm = [
  '      else if (typeof input === "string") {',
  "        let length = 0;",
  "        for (const _ of input) length++;",
  "        yield length;",
  "      }",
].join("\n");
const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../..");
const [mode, first, second] = process.argv.slice(2);
assert.ok(mode === "baseline" || mode === "candidate", "mode must be baseline or candidate");
const candidate = mode === "candidate" ? first : baseline;
const requestedOutput = mode === "candidate" ? second : first;
assert.ok(candidate && requestedOutput, "candidate commit and/or output path missing");
const output = resolve(repository, requestedOutput);
assert.equal(dirname(output), owned, "output must be a new direct child of the author directory");
assert.ok(output.startsWith(`${owned}${sep}`) && !existsSync(output), "output must be fresh and author-owned");
mkdirSync(output); mkdirSync(join(output, "raw")); mkdirSync(join(output, "package"));

const sha256 = value => createHash("sha256").update(value).digest("hex");
const runRecords = [];
let scratch;
let report;

function spawn(executable, args, cwd, extraEnv = {}) {
  return spawnSync(executable, args, {
    cwd,
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: scratch, TMPDIR: scratch, LC_ALL: "C", LANG: "C", TZ: "UTC", ...extraEnv },
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function git(args, encoding = "utf8") {
  const result = spawnSync("/usr/bin/git", args, { cwd: repository, ...(encoding === "buffer" ? {} : { encoding }), maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr)}`);
  return result.stdout;
}

function safeRelative(path) {
  if (!path || path.startsWith("/") || path.includes("\0") || path.split("/").some(part => part === "" || part === "." || part === "..")) {
    throw new Error(`unsafe relative path: ${path}`);
  }
  if (path.split("/").includes("AGENTS.md")) throw new Error(`instruction file prohibited: ${path}`);
}

function treeEntries(commit, paths) {
  const rows = git(["ls-tree", "-rz", "-l", commit, "--", ...paths], "buffer").toString("utf8").split("\0").filter(Boolean);
  return rows.map(row => {
    const match = /^(\d+) (\w+) ([0-9a-f]+)\s+(\d+)\t(.+)$/u.exec(row);
    if (!match) throw new Error(`unrecognized tree row: ${row}`);
    const [, modeText, type, blob, lengthText, path] = match;
    safeRelative(path);
    if (type !== "blob" || (modeText !== "100644" && modeText !== "100755")) throw new Error(`non-regular source input: ${path}`);
    const bytes = git(["cat-file", "blob", blob], "buffer");
    assert.equal(bytes.byteLength, Number(lengthText), path);
    return { path, mode: modeText, blob, bytes, bytesLength: bytes.byteLength, sha256: sha256(bytes), commit };
  });
}

function fixedEntries() {
  const selected = [
    "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json",
    "tests/commands/structured/semantics.test.ts", "tests/commands/structured/resources.test.ts", "tests/commands/structured/helpers.ts",
    "tests/commands/structured-stress/jq-grammar-native-v3.ts", "tests/commands/structured-stress/jq-grammar-native-v3.json",
  ];
  const entries = new Map(treeEntries(baseline, selected).map(entry => [entry.path, entry]));
  const baselineInterpreter = entries.get(sourcePath);
  assert.equal(baselineInterpreter.blob, baselineBlob);
  assert.equal(baselineInterpreter.sha256, baselineSha256);
  if (mode === "candidate") {
    const changed = git(["diff-tree", "--no-commit-id", "--name-only", "-r", candidate]).trim().split("\n").filter(Boolean);
    assert.deepEqual(changed, [sourcePath], "candidate commit must contain only the interpreter source");
    const overlay = treeEntries(candidate, [sourcePath]);
    assert.equal(overlay.length, 1);
    const expected = Buffer.from(baselineInterpreter.bytes.toString().replace(oldArm, candidateArm));
    assert.notDeepEqual(expected, baselineInterpreter.bytes);
    assert.deepEqual(overlay[0].bytes, expected, "candidate must be the exact one-arm overlay");
    entries.set(sourcePath, overlay[0]);
  }
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function field(buffer, offset, length, value) {
  const bytes = Buffer.from(value);
  if (bytes.byteLength > length) throw new Error(`tar field too long: ${value}`);
  bytes.copy(buffer, offset);
}

function octal(value, width) {
  const text = value.toString(8);
  if (text.length > width - 1) throw new Error(`tar number overflow: ${value}`);
  return `${"0".repeat(width - 1 - text.length)}${text}\0`;
}

function tarName(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let at = path.lastIndexOf("/"); at > 0; at = path.lastIndexOf("/", at - 1)) {
    const prefix = path.slice(0, at), name = path.slice(at + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`tar path cannot be represented: ${path}`);
}

function makeTar(entries) {
  const chunks = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    const names = tarName(entry.path);
    field(header, 0, 100, names.name); field(header, 100, 8, octal(entry.mode === "100755" ? 0o755 : 0o644, 8));
    field(header, 108, 8, octal(0, 8)); field(header, 116, 8, octal(0, 8)); field(header, 124, 12, octal(entry.bytesLength, 12));
    field(header, 136, 12, octal(0, 12)); header.fill(32, 148, 156); header[156] = 48;
    field(header, 257, 6, "ustar\0"); field(header, 263, 2, "00"); field(header, 265, 32, "root"); field(header, 297, 32, "root");
    field(header, 329, 8, octal(0, 8)); field(header, 337, 8, octal(0, 8)); field(header, 345, 155, names.prefix);
    field(header, 148, 8, `${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `);
    chunks.push(header, entry.bytes);
    if (entry.bytesLength % 512) chunks.push(Buffer.alloc(512 - entry.bytesLength % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function writeEntry(root, entry) {
  const destination = join(root, entry.path);
  mkdirSync(dirname(destination), { recursive: true });
  if (existsSync(destination)) throw new Error(`refusing reconstructed overwrite: ${entry.path}`);
  writeFileSync(destination, entry.bytes, { mode: entry.mode === "100755" ? 0o755 : 0o644 });
  const stat = lstatSync(destination);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), entry.path);
  assert.equal(sha256(readFileSync(destination)), entry.sha256, entry.path);
}

function regularFiles(root, prefix = "") {
  const rows = [];
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    safeRelative(path);
    const stat = lstatSync(join(root, path));
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`non-regular staged entry: ${path}`);
    if (stat.isDirectory()) rows.push(...regularFiles(root, path));
    else rows.push(path);
  }
  return rows;
}

function copyRegularTree(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const relativePath of regularFiles(source)) {
    const target = join(destination, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(source, relativePath), target);
    chmodSync(target, lstatSync(join(source, relativePath)).mode & 0o111 ? 0o755 : 0o644);
  }
}

function inventory(root) {
  return Object.fromEntries(regularFiles(root).map(path => [path, sha256(readFileSync(join(root, path)))]));
}

function recordRun(name, executable, args, cwd, expected = 0, extraEnv = {}) {
  const result = spawn(executable, args, cwd, extraEnv);
  const stdout = result.stdout ?? "", stderr = result.stderr ?? "";
  writeFileSync(join(output, "raw", `${name}.stdout`), stdout);
  writeFileSync(join(output, "raw", `${name}.stderr`), stderr);
  const row = { name, executable: realpathSync(executable), args, cwdRole: relative(scratch, cwd) || ".", exitCode: result.status,
    signal: result.signal, error: result.error ? { name: result.error.name, message: result.error.message, code: result.error.code ?? null } : null,
    stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr), stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr) };
  runRecords.push(row);
  const accepted = typeof expected === "function" ? expected(row) : row.exitCode === expected;
  if (!accepted) throw new Error(`${name} exited ${row.exitCode}: ${stderr}${stdout}`);
  return { result, row };
}

function writeManifest(path, packageRoot, label) {
  const files = inventory(packageRoot);
  const body = Buffer.from(`${JSON.stringify({ schema: "structured-length-package/1", candidate, label, packageRoot, files }, null, 2)}\n`);
  writeFileSync(path, body);
  return { path, sha256: sha256(body), files };
}

function copyHarness(destination) {
  mkdirSync(destination, { recursive: true });
  for (const name of ["worker.mjs", "vectors.json"]) copyFileSync(join(owned, name), join(destination, name));
}

function parseWorker(result) {
  return JSON.parse(result.stdout.trim());
}

function runWorker(name, harness, workerMode, manifest, expectation, expected = 0) {
  const run = recordRun(name, process.execPath, [join(harness, "worker.mjs"), workerMode, manifest.path, manifest.sha256, expectation ?? "none"], harness, expected);
  if (run.row.exitCode === 0) run.row.receipt = parseWorker(run.result);
  return run;
}

function packageBuild(work, label) {
  const stage = join(scratch, `package-stage-${label}`); mkdirSync(stage);
  copyFileSync(join(work, "package.json"), join(stage, "package.json"));
  copyRegularTree(join(work, "dist"), join(stage, "dist"));
  assert.equal(regularFiles(stage).some(path => path.split("/").includes("AGENTS.md")), false);
  const destination = join(output, "package", label); mkdirSync(destination);
  const packed = recordRun(`${label}-npm-pack`, realpathSync(join(dirname(process.execPath), "npm")), ["pack", "--json", "--ignore-scripts", "--pack-destination", destination], stage);
  const description = JSON.parse(packed.result.stdout);
  assert.equal(description.length, 1);
  const tarball = join(destination, description[0].filename);
  assert.ok(lstatSync(tarball).isFile());
  const listing = recordRun(`${label}-package-list`, "/usr/bin/tar", ["-tzf", tarball], stage).result.stdout.trim().split("\n").filter(Boolean);
  assert.ok(listing.length > 1);
  assert.equal(listing.some(path => path.split("/").includes("AGENTS.md")), false);
  return { tarball, sha256: sha256(readFileSync(tarball)), listing };
}

function installAndMove(work, label, options) {
  const packed = packageBuild(work, label);
  const consumerA = join(scratch, `${label}-consumer-installed`); mkdirSync(consumerA);
  writeFileSync(join(consumerA, "package.json"), '{"name":"length-author-consumer-a","private":true,"type":"module"}\n');
  recordRun(`${label}-offline-install`, realpathSync(join(dirname(process.execPath), "npm")),
    ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", packed.tarball], consumerA);
  const installed = join(consumerA, "node_modules", "virtual-bash");
  assert.ok(lstatSync(installed).isDirectory());
  assert.equal(regularFiles(installed).some(path => path.split("/").includes("AGENTS.md")), false);
  const harnessA = consumerA; copyHarness(harnessA);
  const manifestA = writeManifest(join(consumerA, "manifest-installed.json"), installed, label);
  if (options.publicInstalled) runWorker(`${label}-installed-public`, harnessA, "installed-public", manifestA);
  if (options.typecheck) {
    copyFileSync(join(owned, "consumer.ts.data"), join(consumerA, "consumer.ts"));
    copyFileSync(join(owned, "consumer-tsconfig.json.data"), join(consumerA, "tsconfig.json"));
    recordRun(`${label}-installed-consumer-typecheck`, process.execPath,
      [join(repository, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", "tsconfig.json"], consumerA);
  }
  const beforeTamper = inventory(installed);
  if (options.tamper) {
    const interpreter = join(installed, "dist/commands/structured/interpreter.js");
    const interpreterBytes = readFileSync(interpreter);
    writeFileSync(interpreter, Buffer.concat([interpreterBytes, Buffer.from("\n;void 0;\n")]));
    runWorker(`${label}-tamper-module-denied`, harnessA, "discriminator", manifestA, "noncollecting", row => row.exitCode !== 0);
    writeFileSync(interpreter, interpreterBytes);
    const packageName = join(installed, "package.json");
    const packageBytes = readFileSync(packageName);
    const wrong = JSON.parse(packageBytes); wrong.name = "virtual-bash-wrong";
    writeFileSync(packageName, `${JSON.stringify(wrong, null, 2)}\n`);
    const wrongManifest = writeManifest(join(consumerA, "manifest-wrong-package.json"), installed, `${label}-wrong-package`);
    runWorker(`${label}-tamper-package-denied`, harnessA, "discriminator", wrongManifest, "noncollecting", row => row.exitCode !== 0);
    writeFileSync(packageName, packageBytes);
    assert.deepEqual(inventory(installed), beforeTamper);
  }
  const consumerB = join(scratch, `${label}-consumer-moved`); mkdirSync(join(consumerB, "node_modules"), { recursive: true });
  const moved = join(consumerB, "node_modules", "virtual-bash");
  renameSync(installed, moved);
  assert.equal(existsSync(installed), false); assert.ok(lstatSync(moved).isDirectory());
  copyHarness(consumerB);
  const manifestB = writeManifest(join(consumerB, "manifest-moved.json"), moved, label);
  if (options.publicMoved) runWorker(`${label}-moved-public`, consumerB, "moved-public", manifestB);
  for (const check of options.discriminators) runWorker(`${label}-${check.name}`, consumerB, "discriminator", manifestB, check.expectation, check.expected);
  return { packed, installedPathBeforeMove: installed, movedPath: moved, movedManifest: { sha256: manifestB.sha256, files: manifestB.files } };
}

function regressionCounts(stdout) {
  return Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|skipped|cancelled) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
}

function verifyInputs(work, entries) {
  for (const entry of entries) assert.equal(sha256(readFileSync(join(work, entry.path))), entry.sha256, entry.path);
  const actual = regularFiles(join(work, "src")).map(path => `src/${path}`).sort();
  const expected = entries.filter(entry => entry.path.startsWith("src/")).map(entry => entry.path).sort();
  assert.deepEqual(actual, expected);
}

function removeOwnedTree(root) {
  const resolved = resolve(root);
  assert.ok(resolved.startsWith(`${realpathSync(tmpdir())}${sep}`) && resolved.includes("virtual-bash-length-author-"));
  const remove = path => {
    const stat = lstatSync(path);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const name of readdirSync(path)) remove(join(path, name));
      rmdirSync(path); return;
    }
    if (!stat.isFile()) throw new Error(`refusing cleanup of non-regular scratch entry: ${path}`);
    unlinkSync(path);
  };
  remove(resolved);
}

try {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "virtual-bash-length-author-")));
  const fixtureNames = ["README.md", "vectors.json", "worker.mjs", "deny-native.mjs", "consumer.ts.data", "consumer-tsconfig.json.data", "reconstruct.mjs"];
  const freezeCommit = git(["log", "-1", "--format=%H", "--", relative(repository, join(owned, "worker.mjs"))]).trim();
  assert.ok(freezeCommit);
  const fixtureHashes = {};
  for (const name of fixtureNames) {
    const live = readFileSync(join(owned, name));
    const frozen = git(["show", `${freezeCommit}:${relative(repository, join(owned, name))}`], "buffer");
    assert.deepEqual(live, frozen, `${name} differs from fixture freeze`);
    fixtureHashes[name] = sha256(live);
  }
  const entries = fixedEntries();
  const sourceArchive = makeTar(entries);
  const archivePath = join(output, "SOURCE.tar"); writeFileSync(archivePath, sourceArchive);
  const sourceManifest = { schema: "structured-length-fixed-source/1", baseline, candidate, mode,
    overlay: mode === "candidate" ? { path: sourcePath, recipe: "baseline build inputs plus exact candidateArm replacement", candidateCommit: candidate } : null,
    baselineIsAncestorOfAuthorHead: false,
    entries: entries.map(({ path, mode: entryMode, blob, bytesLength, sha256: hash, commit }) => ({ path, mode: entryMode, blob, bytes: bytesLength, sha256: hash, commit })) };
  writeFileSync(join(output, "SOURCE-MANIFEST.json"), `${JSON.stringify(sourceManifest, null, 2)}\n`);
  const tarList = recordRun("source-archive-list", "/usr/bin/tar", ["-tf", archivePath], repository).result.stdout.trim().split("\n").filter(Boolean);
  assert.deepEqual(tarList, entries.map(entry => entry.path));
  assert.equal(tarList.some(path => path.split("/").includes("AGENTS.md")), false);

  const work = join(scratch, "fixed-source"); mkdirSync(work);
  for (const entry of entries) writeEntry(work, entry);
  const toolchain = {
    node: { path: process.execPath, version: process.version, sha256: sha256(readFileSync(process.execPath)) },
    typescript: { path: join(repository, "node_modules/typescript/bin/tsc"), sha256: sha256(readFileSync(join(repository, "node_modules/typescript/bin/tsc"))) },
    tsxLoader: { path: join(repository, "node_modules/tsx/dist/loader.mjs"), sha256: sha256(readFileSync(join(repository, "node_modules/tsx/dist/loader.mjs"))) },
    npm: { path: realpathSync(join(dirname(process.execPath), "npm")), sha256: sha256(readFileSync(realpathSync(join(dirname(process.execPath), "npm")))) },
  };
  recordRun("strict-build", process.execPath,
    [toolchain.typescript.path, "-p", "tsconfig.build.json", "--typeRoots", join(repository, "node_modules/@types")], work);
  const sourceHarness = join(scratch, "source-harness"); copyHarness(sourceHarness);
  const sourcePackageManifest = writeManifest(join(sourceHarness, "manifest-source.json"), work, `${mode}-source`);
  runWorker("source-direct-focused", sourceHarness, "direct", sourcePackageManifest);

  copyFileSync(join(owned, "deny-native.mjs"), join(sourceHarness, "deny-native.mjs"));
  const denialLog = join(scratch, "native-denial.jsonl"); writeFileSync(denialLog, "");
  const semantic = recordRun("selected-semantic-regressions", process.execPath,
    ["--import", join(sourceHarness, "deny-native.mjs"), "--import", toolchain.tsxLoader.path, "--test", "--test-reporter=tap", "--test-concurrency=1",
      "--test-name-pattern=^(semantic matrix |prototype keys preserve data|integer-like keys retain)", "tests/commands/structured/semantics.test.ts"], work, 0,
    { LENGTH_AUTHOR_NATIVE_DENIAL_LOG: denialLog });
  semantic.row.counts = regressionCounts(semantic.result.stdout);
  assert.deepEqual(semantic.row.counts, { tests: 91, pass: 91, fail: 0, cancelled: 0, skipped: 0 });
  const resources = recordRun("selected-resource-regressions", process.execPath,
    ["--import", join(sourceHarness, "deny-native.mjs"), "--import", toolchain.tsxLoader.path, "--test", "--test-reporter=tap", "--test-concurrency=1",
      "--test-name-pattern=^(limits protect hidden Cartesian expansion, collections, and emitted results|input, source, output, slurp and result budgets enforce boundary values)$",
      "tests/commands/structured/resources.test.ts"], work, 0, { LENGTH_AUTHOR_NATIVE_DENIAL_LOG: denialLog });
  resources.row.counts = regressionCounts(resources.result.stdout);
  assert.deepEqual(resources.row.counts, { tests: 2, pass: 2, fail: 0, cancelled: 0, skipped: 0 });
  assert.equal(readFileSync(denialLog, "utf8"), "");

  const primaryOptions = mode === "baseline" ? {
    publicInstalled: true, typecheck: true, tamper: true, publicMoved: true,
    discriminators: [
      { name: "baseline-candidate-assertion", expectation: "noncollecting", expected: row => row.exitCode !== 0 },
      { name: "baseline-collection-characterization", expectation: "collecting", expected: 0 },
    ],
  } : {
    publicInstalled: true, typecheck: true, tamper: true, publicMoved: true,
    discriminators: [{ name: "candidate-noncollection", expectation: "noncollecting", expected: 0 }],
  };
  const primary = installAndMove(work, mode, primaryOptions);

  let mutant = null;
  if (mode === "candidate") {
    const mutantWork = join(scratch, "reverted-candidate-source"); mkdirSync(mutantWork);
    for (const entry of entries) {
      if (entry.path !== sourcePath) writeEntry(mutantWork, entry);
      else {
        const text = entry.bytes.toString();
        assert.equal(text.includes(candidateArm), true);
        const bytes = Buffer.from(text.replace(candidateArm, oldArm));
        assert.equal(sha256(bytes), baselineSha256);
        writeEntry(mutantWork, { ...entry, bytes, bytesLength: bytes.length, sha256: sha256(bytes), blob: baselineBlob, commit: baseline });
      }
    }
    recordRun("mutant-strict-build", process.execPath,
      [toolchain.typescript.path, "-p", "tsconfig.build.json", "--typeRoots", join(repository, "node_modules/@types")], mutantWork);
    mutant = installAndMove(mutantWork, "reverted-mutant", { publicInstalled: false, typecheck: false, tamper: false, publicMoved: false,
      discriminators: [
        { name: "candidate-assertion", expectation: "noncollecting", expected: row => row.exitCode !== 0 },
        { name: "collection-characterization", expectation: "collecting", expected: 0 },
      ] });
    verifyInputs(mutantWork, entries.map(entry => entry.path === sourcePath
      ? { ...entry, sha256: baselineSha256 }
      : entry));
  }

  verifyInputs(work, entries);
  assert.equal(sha256(readFileSync(archivePath)), sha256(sourceArchive));
  report = { schema: "structured-length-author-result/1", completed: true, mode, baseline, candidate, freezeCommit,
    prerequisiteBindings: { independentFreeze: "20351e9920f89cc2a07a98eb24ac062f42be78ad", runnerCorrection: "fed806142b311a4b79b39806400238100b619ad8",
      baselineEvidence: "c05ea6edf5189772f7210520fbd464c94c290e58", proposal: "debfdd8b42930d8c5f1c0301897e4eeaa68e0979" },
    fixtureHashes, sourceArchive: { path: "SOURCE.tar", sha256: sha256(sourceArchive), bytes: sourceArchive.length, entryCount: entries.length,
      manifestSha256: sha256(readFileSync(join(output, "SOURCE-MANIFEST.json"))) },
    candidateDelta: mode === "candidate" ? { onlyPath: sourcePath, exactArmOverlay: true, baselineBlob, candidateBlob: entries.find(entry => entry.path === sourcePath).blob,
      candidateSha256: entries.find(entry => entry.path === sourcePath).sha256, newBudgetCalls: 0, newSignalChecks: 0, newAwaits: 0, newApi: 0 } : null,
    toolchain, cohorts: { sourceDirectDistinctGroups: 41, installedPublicDistinctGroups: 18, movedDistinctGroups: 2, overlapBetweenAuthorCohorts: 0,
      selectedRegressions: { semantics: 91, resources: 2, total: 93 }, independentHistoricalGroupsNotRescored: 60 },
    desiredNoncollection: mode === "baseline" ? { accepted: false, status: "UNMET", arrayFromCollectionDetected: true }
      : { acceptedByAuthorHarnessOnly: true, status: "candidate observed noncollecting; independent review pending", arrayFromCollectionDetected: false },
    tamperControls: { count: 2, moduleDenied: true, wrongPackageDenied: true },
    package: { sha256: primary.packed.sha256, path: relative(output, primary.packed.tarball), files: primary.packed.listing.length,
      physicallyMoved: true, movedManifestSha256: primary.movedManifest.sha256,
      loadedModules: ["dist/index.js", "dist/commands/structured/interpreter.js", "dist/commands/structured/limits.js", "dist/commands/structured/numbers.js", "dist/contracts/errors.js"]
        .map(path => ({ path, sha256: primary.movedManifest.files[path] })) },
    reversionMutant: mutant ? { candidateArmReplacedOnly: true, oldExpressionSha256: baselineSha256, packageSha256: mutant.packed.sha256,
      candidateExpectationFailed: true, collectionCharacterizationPassed: true, physicallyMoved: true } : "pending candidate",
    runs: runRecords, nativeOrReferenceRuns: 0, rssOrHeapMeasurements: 0, processes: { allExited: true, signals: runRecords.filter(row => row.signal).length },
    sourceAndArchiveUnchangedAfterRuns: true, scratchRemoved: false };
} catch (error) {
  report = { schema: "structured-length-author-result/1", completed: false, mode, baseline, candidate, runs: runRecords,
    failure: { name: error.name, message: error.message, stack: error.stack }, scratchRemoved: false };
  process.exitCode = 1;
} finally {
  if (scratch && existsSync(scratch)) removeOwnedTree(scratch);
  report.scratchRemoved = true;
  writeFileSync(join(output, "REPORT.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ completed: report.completed, mode, candidate, runs: runRecords.map(({ name, exitCode, counts }) => ({ name, exitCode, counts })), output })}\n`);
}

