import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = 1;
const candidate = "f1a90436c45208ca248e058a039893233c608daa";
const mutationCommit = "2748e2abbc2dc838e02b1d75ee7d967f0749e8ad";
const mutationTree = "2e0838b8e92ff88583e4e9651fe5a4549742ada6";
const mutationParent = "710ae52f9f8db6be99aa6798a0246fce4e7b827e";
const finalAuditEvidenceCommit = "7a8e7bebc96156e511fc91389341d87e5aba317c";
const finalAuditFreezeCommit = "a67ae4e81a728b198d181095f6ca7c87a138b25c";
const mutationPrefix = "tests/commands/tree-charset-independent-20260827/mutation-controls/";
const finalAuditPath = "tests/commands/tree-charset-independent-20260827/final-audit";
const harnessRoot = dirname(fileURLToPath(import.meta.url));
const ownedRoot = resolve(harnessRoot, "..");
const repositoryRoot = resolve(harnessRoot, "../../../../../");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const wrapperCommands = [];

function errorRecord(error) {
  return {
    name: error?.name ?? typeof error,
    message: error?.message ?? String(error),
    code: error?.code ?? null,
    stack: typeof error?.stack === "string" ? error.stack.split("\n").slice(0, 16) : [],
  };
}

async function executable(name) {
  assert.match(name, /^[A-Za-z0-9_.+-]+$/u);
  for (const folder of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const path = resolve(folder, name);
    try { await access(path, fsConstants.X_OK); return path; }
    catch { /* continue */ }
  }
  throw new Error(`Executable not found: ${name}`);
}

async function absentPid(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error?.code === "ESRCH") return true; throw error; }
}

async function absentGroup(pid) {
  if (process.platform === "win32") return null;
  try { process.kill(-pid, 0); return false; }
  catch (error) { if (error?.code === "ESRCH") return true; throw error; }
}

async function runBounded(label, command, args, options = {}) {
  assert.match(label, /^[a-z0-9][a-z0-9-]*$/u);
  const stdout = [], stderr = [];
  let stdoutBytes = 0, stderrBytes = 0, timedOut = false, overflow = false;
  const limit = options.outputLimit ?? 4 * 1024 * 1024;
  const child = spawn(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pid = child.pid;
  const killScope = () => {
    if (process.platform !== "win32") {
      try { process.kill(-pid, "SIGKILL"); return; }
      catch (error) { if (error?.code !== "ESRCH") throw error; }
    }
    child.kill("SIGKILL");
  };
  const capture = (chunks, which) => chunk => {
    const copy = Buffer.from(chunk);
    if (which === "stdout") stdoutBytes += copy.byteLength;
    else stderrBytes += copy.byteLength;
    if (stdoutBytes + stderrBytes <= limit) chunks.push(copy);
    else if (!overflow) { overflow = true; killScope(); }
  };
  child.stdout.on("data", capture(stdout, "stdout"));
  child.stderr.on("data", capture(stderr, "stderr"));
  let exitEvent;
  child.once("exit", (code, signal) => { exitEvent = { code, signal }; });
  const timeoutMs = options.timeoutMs ?? 30000;
  const timer = setTimeout(() => { timedOut = true; killScope(); }, timeoutMs);
  const closeEvent = await new Promise(accept => child.once("close", (code, signal) => accept({ code, signal })));
  clearTimeout(timer);
  const stdoutBuffer = Buffer.concat(stdout);
  const stderrBuffer = Buffer.concat(stderr);
  const record = {
    label, command, args, cwd: options.cwd ?? repositoryRoot, pid, timeoutMs,
    timedOut, overflow, exitEvent, closeEvent, stdoutBytes, stderrBytes,
    stdoutSha256: sha256(stdoutBuffer), stderrSha256: sha256(stderrBuffer),
    absentAfterClose: await absentPid(pid),
    processGroupAbsentAfterClose: await absentGroup(pid),
  };
  wrapperCommands.push(record);
  const expectedCodes = options.expectedCodes ?? [0];
  assert.ok(expectedCodes.includes(closeEvent.code) && closeEvent.signal === null,
    `${label} failed (${closeEvent.code}, ${closeEvent.signal}): ${stderrBuffer.toString("utf8")}`);
  assert.equal(timedOut, false, `${label} timed out`);
  assert.equal(overflow, false, `${label} exceeded output bound`);
  assert.equal(record.absentAfterClose, true, `${label} PID remains after close`);
  assert.notEqual(record.processGroupAbsentAfterClose, false, `${label} process group remains after close`);
  return { record, stdout: stdoutBuffer, stderr: stderrBuffer };
}

async function fileRecord(path) {
  const resolvedPath = await realpath(path);
  const bytes = await readFile(resolvedPath);
  return { path, resolvedPath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function replaceExactly(source, label, search, replacement, transformations) {
  const count = source.split(search).length - 1;
  assert.equal(count, 1, `${label}: expected exactly one derivative site, got ${count}`);
  transformations.push({
    label,
    occurrences: count,
    searchBytes: Buffer.byteLength(search),
    searchSha256: sha256(search),
    replacementBytes: Buffer.byteLength(replacement),
    replacementSha256: sha256(replacement),
  });
  return source.replace(search, replacement);
}

function deriveRun(original) {
  const transformations = [];
  let source = original;
  source = replaceExactly(source, "explicit-output-root",
    'const controlRoot = resolve(harnessRoot, "..");',
    "const controlRoot = process.env.LOAD_AUTH_OUTPUT_ROOT;", transformations);
  source = replaceExactly(source, "explicit-repository-root",
    'const repositoryRoot = resolve(harnessRoot, "../../../../..");',
    "const repositoryRoot = process.env.LOAD_AUTH_REPOSITORY_ROOT;", transformations);
  source = replaceExactly(source, "explicit-fixture-path",
    '  const fixturePath = join(controlRoot, "fixtures/consumer-package.json");',
    "  const fixturePath = process.env.LOAD_AUTH_FIXTURE_PATH;", transformations);
  source = replaceExactly(source, "instrumentation-tool-manifest",
    '  const harnessPaths = ["run.mjs", "mutations.mjs", "worker.mjs", "load-guard.mjs"].map(name => join(harnessRoot, name));',
    '  const harnessPaths = ["run.mjs", "mutations.mjs", "worker.mjs", "load-guard.mjs", "bootstrap.mjs", "load-hash-loader.mjs"].map(name => join(harnessRoot, name));', transformations);

  const oldRunWorker = `async function runWorker(attemptRoot, variantRoot, variant) {
  const worker = join(variantRoot, "worker.mjs");
  await copyFile(join(harnessRoot, "worker.mjs"), worker);
  const result = await runCommand(attemptRoot, \`worker-\${variant}\`, process.execPath,
    ["--unhandled-rejections=strict", worker], {
      cwd: variantRoot,
      env: {
        PATH: process.env.PATH ?? dirname(process.execPath),
        LANG: "C", LC_ALL: "C", TZ: "UTC", MUTATION_VARIANT: variant,
      },
      timeoutMs: 15000,
      outputLimit: 2 * 1024 * 1024,
    });
  assertCommand(result);
  const parsed = JSON.parse(result.stdout.toString("utf8"));
  assert.equal(parsed.pid, result.record.pid);
  return { process: result.record, result: parsed };
}`;
  const newRunWorker = `async function runWorker(attemptRoot, variantRoot, variant, declaredTargets) {
  const worker = join(variantRoot, "worker.mjs");
  const bootstrap = join(variantRoot, "load-auth-bootstrap.mjs");
  const loader = join(variantRoot, "load-hash-loader.mjs");
  const recordsPath = join(attemptRoot, "raw", \`worker-\${variant}.loads.jsonl\`);
  const packageRoot = join(variantRoot, "node_modules/virtual-bash");
  await copyFile(join(harnessRoot, "worker.mjs"), worker);
  await copyFile(join(harnessRoot, "bootstrap.mjs"), bootstrap);
  await copyFile(join(harnessRoot, "load-hash-loader.mjs"), loader);
  const loaderTargets = declaredTargets.map(target => ({
    relativePath: target.file,
    absolutePath: join(packageRoot, ...target.file.split("/")),
    expectedLoadedSourceSha256: target.afterSha256,
  }));
  const result = await runCommand(attemptRoot, \`worker-\${variant}\`, process.execPath,
    ["--unhandled-rejections=strict", "--import", bootstrap, worker], {
      cwd: variantRoot,
      env: {
        PATH: process.env.PATH ?? dirname(process.execPath),
        LANG: "C", LC_ALL: "C", TZ: "UTC", MUTATION_VARIANT: variant,
        LOAD_AUTH_CASE_ID: variant,
        LOAD_AUTH_LOADER_PATH: loader,
        LOAD_AUTH_RECORD_PATH: recordsPath,
        LOAD_AUTH_PACKAGE_ROOT: packageRoot,
        LOAD_AUTH_TARGETS: JSON.stringify(loaderTargets),
      },
      timeoutMs: 15000,
      outputLimit: 2 * 1024 * 1024,
    });
  assertCommand(result);
  const parsed = JSON.parse(result.stdout.toString("utf8"));
  assert.equal(parsed.pid, result.record.pid);
  const recordText = await readFile(recordsPath, "utf8");
  assert.ok(Buffer.byteLength(recordText) <= 65536 * declaredTargets.length);
  const records = recordText.split("\\n").filter(Boolean).map(line => JSON.parse(line));
  assert.equal(records.length, declaredTargets.length, \`\${variant}: target load record count\`);
  const loadAttestations = [];
  for (const target of declaredTargets) {
    const matches = records.filter(record => record.caseId === variant && record.targetModule === target.file);
    assert.equal(matches.length, 1, \`\${variant}: expected one load for \${target.file}\`);
    const record = matches[0];
    const onDiskAfterWorkerSha256 = sha256(await readFile(join(packageRoot, ...target.file.split("/"))));
    assert.equal(record.loadedSourceSha256, target.afterSha256);
    assert.equal(record.onDiskAtLoadSha256, target.afterSha256);
    assert.equal(onDiskAfterWorkerSha256, target.afterSha256);
    assert.equal(record.resolvedCanonicalURL, record.canonicalTargetURL);
    if (target.mutated) assert.notEqual(target.afterSha256, target.baselineLoadedSourceSha256);
    else assert.equal(target.afterSha256, target.baselineLoadedSourceSha256);
    loadAttestations.push({
      caseId: variant,
      targetModule: target.file,
      onDiskBeforeSha256: target.beforeSha256,
      onDiskAfterSha256: target.afterSha256,
      onDiskAfterWorkerSha256,
      expectedMutationSha256: target.afterSha256,
      baselineLoadedSourceSha256: target.baselineLoadedSourceSha256,
      actualLoadedSourceSha256: record.loadedSourceSha256,
      onDiskAtLoadSha256: record.onDiskAtLoadSha256,
      targetURL: record.targetURL,
      resolvedCanonicalURL: record.resolvedCanonicalURL,
      sourceBytes: record.sourceBytes,
      format: record.format,
      actualLoadedHashEqualsAfterHash: record.loadedSourceSha256 === target.afterSha256,
      actualLoadedHashDiffersFromBaselineHash: record.loadedSourceSha256 !== target.baselineLoadedSourceSha256,
      baselineCase: !target.mutated,
      declaration: target.mutated
        ? "actualLoadedSourceSha256 == onDiskAfterSha256 != baselineLoadedSourceSha256"
        : "actualLoadedSourceSha256 == onDiskBeforeSha256 == onDiskAfterSha256",
    });
  }
  return { process: result.record, result: parsed, loadAttestations };
}`;
  source = replaceExactly(source, "pre-entry-loader-worker-launch", oldRunWorker, newRunWorker, transformations);

  const oldBaseline = `  const baseline = await runWorker(attemptRoot, consumerRoot, "baseline");
  assert.equal(baseline.result.pass, true, json(baseline.result));
  assert.equal(baseline.result.failed, 0);`;
  const newBaseline = `  const baselinePackageRoot = join(consumerRoot, "node_modules/virtual-bash");
  const baselineFiles = [...new Set(mutations.map(mutation => mutation.file))];
  const baselineTargets = [];
  for (const file of baselineFiles) {
    const baselineSha256 = sha256(await readFile(join(baselinePackageRoot, ...file.split("/"))));
    baselineTargets.push({ file, beforeSha256: baselineSha256, afterSha256: baselineSha256,
      baselineLoadedSourceSha256: baselineSha256, mutated: false });
  }
  const baseline = await runWorker(attemptRoot, consumerRoot, "baseline", baselineTargets);
  assert.equal(baseline.result.pass, true, json(baseline.result));
  assert.equal(baseline.result.failed, 0);
  const baselineLoadByFile = new Map(baseline.loadAttestations.map(item => [item.targetModule, item]));`;
  source = replaceExactly(source, "baseline-loaded-module-hashes", oldBaseline, newBaseline, transformations);

  const oldMutantLaunch = `    const mutationRecord = await applyMutation(join(variantRoot, "node_modules/virtual-bash"), mutation);
    const run = await runWorker(attemptRoot, variantRoot, mutation.id);`;
  const newMutantLaunch = `    const mutationRecord = await applyMutation(join(variantRoot, "node_modules/virtual-bash"), mutation);
    const baselineLoad = baselineLoadByFile.get(mutation.file);
    assert.ok(baselineLoad, \`\${mutation.id}: missing baseline load hash\`);
    assert.equal(mutationRecord.beforeSha256, baselineLoad.actualLoadedSourceSha256);
    assert.notEqual(mutationRecord.afterSha256, mutationRecord.beforeSha256);
    const run = await runWorker(attemptRoot, variantRoot, mutation.id, [{
      file: mutation.file,
      beforeSha256: mutationRecord.beforeSha256,
      afterSha256: mutationRecord.afterSha256,
      baselineLoadedSourceSha256: baselineLoad.actualLoadedSourceSha256,
      mutated: true,
    }]);`;
  source = replaceExactly(source, "declared-mutant-hash-worker-launch", oldMutantLaunch, newMutantLaunch, transformations);

  const oldTarget = `    assert.equal(target.pass, false, \`\${mutation.id}: target check survived\`);
    mutantRuns.push({ mutation: mutationRecord, ...run });`;
  const newTarget = `    assert.equal(target.pass, false, \`\${mutation.id}: target check survived\`);
    assert.equal(target.error?.name, "AssertionError", \`\${mutation.id}: mapped failure was not AssertionError\`);
    assert.equal(target.error?.code, "ERR_ASSERTION", \`\${mutation.id}: mapped failure was not ERR_ASSERTION\`);
    assert.equal(run.loadAttestations.length, 1);
    assert.equal(run.loadAttestations[0].actualLoadedHashEqualsAfterHash, true);
    assert.equal(run.loadAttestations[0].actualLoadedHashDiffersFromBaselineHash, true);
    mutantRuns.push({ mutation: mutationRecord, ...run });`;
  source = replaceExactly(source, "mapped-assertion-and-load-attestation", oldTarget, newTarget, transformations);

  const oldOutputStart = `    schema: 1,
    candidate,
    createdAt: new Date().toISOString(),`;
  const newOutputStart = `    schema: 2,
    candidate,
    mutationBaseCommit: "${mutationCommit}",
    instrumentationVersion: ${version},
    createdAt: new Date().toISOString(),`;
  source = replaceExactly(source, "result-schema-provenance", oldOutputStart, newOutputStart, transformations);

  const oldInstall = `    install: { before: installedBefore, unchangedAfterRuns: true },
    loadControls: { expected: expectedLoad, positive: positiveLoad, wrongInstalled: wrongLoad, outsideSameBytes: outsideLoad },`;
  const newInstall = `    install: { before: installedBefore, unchangedAfterRuns: true },
    loadAuthentication: {
      baseline: baseline.loadAttestations,
      mutants: mutantRuns.map(item => ({
        caseId: item.mutation.id,
        targetCheck: item.mutation.targetCheck,
        mappedFailure: {
          name: item.result.checks.find(check => check.id === item.mutation.targetCheck)?.error?.name,
          code: item.result.checks.find(check => check.id === item.mutation.targetCheck)?.error?.code,
        },
        attestation: item.loadAttestations[0],
      })),
      allMutantsLoadedDeclaredAfterHash: mutantRuns.every(item =>
        item.loadAttestations[0]?.actualLoadedHashEqualsAfterHash === true),
      allMutantLoadedHashesDifferFromBaseline: mutantRuns.every(item =>
        item.loadAttestations[0]?.actualLoadedHashDiffersFromBaselineHash === true),
    },
    loadControls: { expected: expectedLoad, positive: positiveLoad, wrongInstalled: wrongLoad, outsideSameBytes: outsideLoad },`;
  source = replaceExactly(source, "result-load-authentication-manifest", oldInstall, newInstall, transformations);

  const oldAttempt = `const attemptEntries = await readdir(controlRoot);
const attemptNumbers = attemptEntries.map(name => /^attempt-(\\d{3})$/u.exec(name)?.[1]).filter(Boolean).map(Number);
const attemptName = \`attempt-\${String(Math.max(0, ...attemptNumbers) + 1).padStart(3, "0")}\`;
const attemptRoot = join(controlRoot, attemptName);
const workRoot = join(controlRoot, ".work", attemptName);
await mkdir(join(attemptRoot, "raw"), { recursive: true });`;
  const newAttempt = `const attemptName = process.env.LOAD_AUTH_ATTEMPT_NAME;
assert.match(attemptName ?? "", /^attempt-\\d{3}$/u);
const attemptRoot = join(controlRoot, attemptName);
const workRoot = join(controlRoot, ".work", attemptName);
await mkdir(attemptRoot);
await mkdir(join(attemptRoot, "raw"));`;
  source = replaceExactly(source, "refuse-attempt-overwrite", oldAttempt, newAttempt, transformations);
  return { source, transformations };
}

async function main() {
  assert.equal(resolve(process.cwd()), repositoryRoot, "run from repository root");
  const argv = process.argv.slice(2);
  assert.equal(argv.length, 2, "usage: run-v1.mjs --output <new attempt path>");
  assert.equal(argv[0], "--output");
  const attemptRoot = resolve(repositoryRoot, argv[1]);
  assert.equal(dirname(attemptRoot), ownedRoot, "output must be a direct child of owned subtree");
  assert.match(basename(attemptRoot), /^attempt-\d{3}$/u);
  await assert.rejects(stat(attemptRoot), error => error?.code === "ENOENT", "output attempt already exists");

  const git = await executable("git");
  const resolvedMutation = await runBounded("resolve-mutation-commit", git,
    ["rev-parse", "--verify", `${mutationCommit}^{commit}`]);
  assert.equal(resolvedMutation.stdout.toString("utf8").trim(), mutationCommit);
  const resolvedTree = await runBounded("resolve-mutation-tree", git,
    ["rev-parse", "--verify", `${mutationCommit}^{tree}`]);
  assert.equal(resolvedTree.stdout.toString("utf8").trim(), mutationTree);
  const resolvedParent = await runBounded("resolve-mutation-parent", git,
    ["rev-parse", "--verify", `${mutationCommit}^`]);
  assert.equal(resolvedParent.stdout.toString("utf8").trim(), mutationParent);
  const changed = await runBounded("mutation-changed-paths", git,
    ["diff-tree", "--no-commit-id", "--name-only", "-r", mutationCommit]);
  const changedPaths = changed.stdout.toString("utf8").trim().split("\n").filter(Boolean);
  assert.ok(changedPaths.length > 0);
  assert.ok(changedPaths.every(path => path.startsWith(mutationPrefix)),
    "mutation commit changed a path outside the authenticated mutation-controls subtree");
  const resolvedCandidate = await runBounded("resolve-candidate-commit", git,
    ["rev-parse", "--verify", `${candidate}^{commit}`]);
  assert.equal(resolvedCandidate.stdout.toString("utf8").trim(), candidate);
  for (const oid of [finalAuditEvidenceCommit, finalAuditFreezeCommit]) {
    const resolved = await runBounded(`resolve-final-audit-${oid.slice(0, 8)}`, git,
      ["rev-parse", "--verify", `${oid}^{commit}`]);
    assert.equal(resolved.stdout.toString("utf8").trim(), oid);
  }
  const finalAuditLog = await runBounded("final-audit-path-log", git,
    ["log", "--format=%H %s", "--", finalAuditPath]);
  const finalAuditLogText = finalAuditLog.stdout.toString("utf8");
  assert.match(finalAuditLogText, new RegExp(`^${finalAuditFreezeCommit} `, "mu"));
  assert.match(finalAuditLogText, new RegExp(`^${finalAuditEvidenceCommit} `, "mu"));

  await mkdir(join(ownedRoot, ".work"), { recursive: true });
  const runtimeRoot = await mkdtemp(join(ownedRoot, ".work", "run-v1-"));
  const originalRoot = join(runtimeRoot, "original");
  const derivedRoot = join(runtimeRoot, "derived");
  await mkdir(originalRoot);
  await mkdir(derivedRoot);
  const sourceNames = ["run.mjs", "mutations.mjs", "worker.mjs", "load-guard.mjs"];
  const originals = new Map();
  const sourceAuthentication = [];
  for (const name of sourceNames) {
    const gitPath = `${mutationPrefix}harness/${name}`;
    const shown = await runBounded(`show-${name.replaceAll(".", "-")}`, git,
      ["show", `${mutationCommit}:${gitPath}`], { outputLimit: 2 * 1024 * 1024 });
    originals.set(name, shown.stdout);
    await writeFile(join(originalRoot, name), shown.stdout);
    sourceAuthentication.push({ path: gitPath, bytes: shown.stdout.byteLength, sha256: sha256(shown.stdout) });
  }
  const fixtureGitPath = `${mutationPrefix}fixtures/consumer-package.json`;
  const fixtureShown = await runBounded("show-consumer-fixture", git,
    ["show", `${mutationCommit}:${fixtureGitPath}`]);
  const fixturePath = join(runtimeRoot, "consumer-package.json");
  await writeFile(fixturePath, fixtureShown.stdout);
  sourceAuthentication.push({ path: fixtureGitPath, bytes: fixtureShown.stdout.byteLength,
    sha256: sha256(fixtureShown.stdout) });

  const derived = deriveRun(originals.get("run.mjs").toString("utf8"));
  await writeFile(join(derivedRoot, "run.mjs"), derived.source);
  for (const name of sourceNames.slice(1)) await writeFile(join(derivedRoot, name), originals.get(name));
  for (const name of ["bootstrap.mjs", "load-hash-loader.mjs"]) {
    await writeFile(join(derivedRoot, name), await readFile(join(harnessRoot, name)));
  }
  const derivativeFiles = [];
  for (const name of [...sourceNames, "bootstrap.mjs", "load-hash-loader.mjs"]) {
    derivativeFiles.push(await fileRecord(join(derivedRoot, name)));
  }
  const diff = await runBounded("derivative-diff", git,
    ["diff", "--no-index", "--src-prefix=a/", "--dst-prefix=b/", "--", originalRoot, derivedRoot],
    { expectedCodes: [1], outputLimit: 2 * 1024 * 1024 });
  const normalizedDiff = Buffer.from(diff.stdout.toString("utf8").replaceAll(runtimeRoot, "$RUNTIME"));

  const derivativeRun = await runBounded("derived-mutation-run", process.execPath,
    ["--unhandled-rejections=strict", join(derivedRoot, "run.mjs")], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        LANG: "C", LC_ALL: "C", TZ: "UTC",
        LOAD_AUTH_OUTPUT_ROOT: ownedRoot,
        LOAD_AUTH_REPOSITORY_ROOT: repositoryRoot,
        LOAD_AUTH_FIXTURE_PATH: fixturePath,
        LOAD_AUTH_ATTEMPT_NAME: basename(attemptRoot),
      },
      timeoutMs: 10 * 60 * 1000,
      outputLimit: 4 * 1024 * 1024,
    });
  const outcome = JSON.parse(derivativeRun.stdout.toString("utf8"));
  assert.equal(outcome.pass, true, json(outcome));
  assert.equal(outcome.attempt, basename(attemptRoot));
  const resultsPath = join(attemptRoot, "results.json");
  const results = JSON.parse(await readFile(resultsPath, "utf8"));
  assert.equal(results.schema, 2);
  assert.equal(results.candidate, candidate);
  assert.equal(results.mutationBaseCommit, mutationCommit);
  assert.equal(results.summary.baselineAssertionsPassed, 11);
  assert.equal(results.summary.baselineAssertionsFailed, 0);
  assert.equal(results.summary.mutants, 8);
  assert.equal(results.summary.mutantsKilled, 8);
  assert.equal(results.summary.targetChecksKilled, 8);
  assert.equal(results.loadAuthentication.mutants.length, 8);
  assert.equal(results.loadAuthentication.allMutantsLoadedDeclaredAfterHash, true);
  assert.equal(results.loadAuthentication.allMutantLoadedHashesDifferFromBaseline, true);
  assert.ok(results.loadAuthentication.mutants.every(item =>
    item.mappedFailure.name === "AssertionError" && item.mappedFailure.code === "ERR_ASSERTION"));

  await writeFile(join(attemptRoot, "raw", "derived-driver.stdout"), derivativeRun.stdout);
  await writeFile(join(attemptRoot, "raw", "derived-driver.stderr"), derivativeRun.stderr);
  await writeFile(join(attemptRoot, "derivative.diff"), normalizedDiff);
  await writeFile(join(attemptRoot, "load-authentication.json"), json(results.loadAuthentication));
  const provenance = {
    schema: 1,
    instrumentationVersion: version,
    candidate,
    mutationBase: {
      commit: mutationCommit,
      tree: mutationTree,
      parent: mutationParent,
      changedPathCount: changedPaths.length,
      changedPaths,
      onlyMutationControlsChanged: true,
      sourceAuthentication,
    },
    finalAudit: {
      evidenceCommit: finalAuditEvidenceCommit,
      postCommitFreezeCommit: finalAuditFreezeCommit,
      ownedPathLog: finalAuditLogText.trim().split("\n"),
      recordedGap: "specific mutated-module load-time hashes remain unrecorded",
    },
    derivative: {
      originalRunSha256: sha256(originals.get("run.mjs")),
      derivedRunSha256: sha256(derived.source),
      transformations: derived.transformations,
      files: derivativeFiles,
      normalizedDiff: { bytes: normalizedDiff.byteLength, sha256: sha256(normalizedDiff) },
      unchangedInputs: ["mutations.mjs", "worker.mjs", "load-guard.mjs", "consumer-package.json"],
    },
    wrapper: await fileRecord(fileURLToPath(import.meta.url)),
    wrapperCommands,
    allWrapperChildrenClosed: wrapperCommands.every(command => command.absentAfterClose),
    allWrapperProcessGroupsClosed: wrapperCommands.every(command => command.processGroupAbsentAfterClose !== false),
    wrapperTimeouts: wrapperCommands.filter(command => command.timedOut).length,
    wrapperOutputOverflows: wrapperCommands.filter(command => command.overflow).length,
  };
  await writeFile(join(attemptRoot, "derivative-authentication.json"), json(provenance));
  await writeFile(join(attemptRoot, "wrapper-commands.json"), json(wrapperCommands));
  await rm(runtimeRoot, { recursive: true, force: true });
  process.stdout.write(json({
    schema: 1,
    pass: true,
    attempt: basename(attemptRoot),
    candidate,
    baseline: `${results.summary.baselineAssertionsPassed}/${results.summary.baselineAssertionsPassed + results.summary.baselineAssertionsFailed}`,
    mutantLoadAttestations: results.loadAuthentication.mutants.length,
    mutantKills: results.summary.mutantsKilled,
  }));
}

try {
  await main();
} catch (error) {
  process.stderr.write(json({ schema: 1, pass: false, error: errorRecord(error), wrapperCommands }));
  process.exitCode = 1;
}

