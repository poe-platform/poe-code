import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const repository = process.cwd();
const owned = "tests/fs/s3/http/final-verification/service";
const baseline = "0d29f4d5e90cebc6976a51ddbeba883288126aa0";
const overlay = "f65038e0d3e62b7fe4c05b47c1ab9d3ee364abbb";
const handoff = "42056669f2373f2d34a96bce39aecb940f183ebc";
const independent = "tests/fs/s3/http-independent";
const evidence = join(owned, process.argv[2] ?? "evidence");
assert.equal(resolve(repository), "/Users/kjopek/Workspace/safe-bash");
assert.ok(resolve(evidence).startsWith(resolve(owned) + "/"));
assert.equal(existsSync(evidence), false, "never overwrite a prior replay");
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(join(resolve(owned), ".scratch-"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = args => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const json = path => JSON.parse(readFileSync(path, "utf8"));
function manifest(directory, prefix = "") {
  const entries = {};
  for (const entry of readdirSync(join(directory, prefix), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(entries, manifest(directory, path));
    else if (entry.isFile()) entries[path] = hash(readFileSync(join(directory, path)));
  }
  return entries;
}
function committed(paths, revisionFor) {
  const refs = paths.map(path => `${revisionFor(path)}:${path}`);
  const output = execFileSync("git", ["cat-file", "--batch"], { input: refs.join("\n") + "\n", maxBuffer: 32 * 1024 * 1024 });
  let offset = 0;
  return Object.fromEntries(paths.map(path => {
    const end = output.indexOf(10, offset);
    const header = output.subarray(offset, end).toString();
    const size = Number(header.split(" ")[2]);
    assert.ok(Number.isSafeInteger(size), header);
    const digest = hash(output.subarray(end + 1, end + 1 + size));
    offset = end + 1 + size + 1;
    return [path, digest];
  }));
}
function save(name, value) {
  const path = join(evidence, name);
  assert.equal(existsSync(path), false, path);
  const text = JSON.stringify(value, null, 2) + "\n";
  execFileSync("apply_patch", [], { input: `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`, maxBuffer: 1024 * 1024 });
}
const audit = { startedAt: new Date().toISOString(), baseline, overlay, handoff, scratch, node: process.version,
  nodeSha256: hash(readFileSync(process.execPath)), host: execFileSync("uname", ["-a"], { encoding: "utf8" }),
  headBefore: git(["rev-parse", "HEAD"]).trim(), statusBefore: git(["status", "--short"]), indexBefore: git(["diff", "--cached", "--name-only"]), phases: [] };
const sourcePaths = git(["ls-tree", "-r", "--name-only", baseline, "src"]).trim().split("\n");
const packagePaths = ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"];
const inputPaths = git(["ls-tree", "-r", "--name-only", handoff, independent]).trim().split("\n").filter(path => !path.includes("/evidence/"));
const authorPaths = git(["ls-tree", "-r", "--name-only", baseline, "tests/fs/s3/http"]).trim().split("\n");
const current = paths => Object.fromEntries(paths.map(path => [path, existsSync(path) ? hash(readFileSync(path)) : null]));
const expectedSources = committed(sourcePaths, path => path.startsWith("src/fs/s3/http/") ? overlay : baseline);
const expectedPackages = committed(packagePaths, () => baseline);
const expectedInputs = committed(inputPaths, () => handoff);
const expectedAuthors = committed(authorPaths, () => baseline);
audit.currentBefore = current([...sourcePaths, ...packagePaths]);
audit.handoffInputsBefore = current(inputPaths);
audit.authorInputsBefore = current(authorPaths);
audit.currentDifferencesFromFrozen = Object.entries({ ...expectedSources, ...expectedPackages }).filter(([path, digest]) => audit.currentBefore[path] !== digest).map(([path]) => path);
audit.currentHttpMatchesOverlayBefore = sourcePaths.filter(path => path.startsWith("src/fs/s3/http/")).every(path => audit.currentBefore[path] === expectedSources[path]);
assert.deepEqual(audit.handoffInputsBefore, expectedInputs);
assert.deepEqual(audit.authorInputsBefore, expectedAuthors);
assert.equal(audit.currentHttpMatchesOverlayBefore, true);
let setup;
let frozenBefore;
let packedBefore;
const activeGroups = new Set();
async function run(label, args, cwd = repository, timeout = 180000) {
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, TMPDIR: scratch }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  activeGroups.add(child.pid);
  let stdout = "", stderr = "", timedOut = false, forced;
  child.stdout.on("data", bytes => { stdout += bytes; });
  child.stderr.on("data", bytes => { stderr += bytes; });
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    forced = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 5000);
  }, timeout);
  const result = await new Promise((resolveResult, reject) => {
    child.once("error", reject);
    child.once("close", (status, signal) => resolveResult({ status, signal }));
  }).finally(() => { clearTimeout(timer); clearTimeout(forced); activeGroups.delete(child.pid); });
  audit.phases.push({ label, executable: process.execPath, args, cwd, startedAt, endedAt: new Date().toISOString(), pid: child.pid, ...result, timedOut, stdout, stderr });
  console.log(JSON.stringify({ label, ...result, timedOut }));
  assert.equal(timedOut, false, label);
  assert.equal(result.status, 0, `${label}: ${stdout}\n${stderr}`);
  return stdout;
}
function processes(binary) {
  return execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" }).split("\n").map(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match ? { pid: Number(match[1]), parent: Number(match[2]), command: match[3] } : undefined;
  }).filter(row => row && (row.command === binary || row.command.startsWith(binary + " ")));
}
function rawFiles(directory) {
  return Object.fromEntries(Object.entries(manifest(directory)).map(([path, sha256]) => [path, { sha256, base64: readFileSync(join(directory, path)).toString("base64") }]));
}
try {
  const prepared = JSON.parse(await run("unchanged-prepare", [join(independent, "prepare.mjs"), overlay]));
  setup = json(join(prepared.directory, "prepare.json"));
  assert.equal(setup.revision, baseline); assert.equal(setup.overlay, overlay);
  assert.deepEqual(setup.sourceHashes, expectedSources);
  assert.deepEqual(Object.fromEntries(packagePaths.map(path => [path, hash(readFileSync(join(setup.source, path)))])), expectedPackages);
  assert.deepEqual(Object.fromEntries(authorPaths.map(path => [path, hash(readFileSync(join(setup.source, path)))])), expectedAuthors);
  assert.deepEqual(Object.fromEntries(inputPaths.map(path => [path, hash(readFileSync(join(setup.source, path)))])), expectedInputs);
  frozenBefore = { ...manifest(setup.source, "src"), ...manifest(setup.source, "dist"), ...expectedPackages };
  const compiler = join(repository, "node_modules/typescript/bin/tsc");
  const flags = ["--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--skipLibCheck", "--types", "node", "--typeRoots", join(repository, "node_modules/@types")];
  copyFileSync(join(setup.source, independent, "public-workflow.mts"), join(setup.consumer, "public-workflow.mts"));
  await run("unchanged-public-workflow-strict-types", [compiler, ...flags, "public-workflow.mts"], setup.consumer);
  packedBefore = manifest(join(setup.consumer, "node_modules/virtual-bash"));
  assert.equal(packedBefore["package.json"], expectedPackages["package.json"]);
  audit.frozenBefore = frozenBefore; audit.packedBefore = packedBefore;
  audit.packageSha256 = setup.packageSha256;
  audit.validateSelection = "Only its unchanged public-workflow copy/strict-compile recipe; validate.mjs combined129 and mutants intentionally not invoked by this leaf.";
  await run("unchanged-official-download", [join(independent, "download-service.mjs"), setup.directory]);
  await run("unchanged-author-service-replay", [join(independent, "replay-author-service.mjs"), setup.directory], repository, 300000);
  await run("unchanged-packed-public-service", [join(independent, "minio-service.mjs"), setup.directory, join(setup.directory, "minio")], repository, 120000);
  const author = json(join(setup.directory, "author-service-replay.json"));
  const publicReport = json(join(setup.directory, "independent-minio/report.json"));
  assert.deepEqual(author.results.map(row => [row.suite, row.status]), [["transport-check", 0], ["fallback-check", 0], ["guards", 1]]);
  for (const [index, name, total] of [[0, "transport", 18], [1, "fallback", 14]]) {
    const rows = author.results[index].evidence[`${name}-results.json`];
    assert.equal(rows.length, total); assert.equal(rows.filter(row => row.passed).length, total);
  }
  const authorGuards = author.results[2].evidence["guards.json"];
  assert.equal(authorGuards.length, 17); assert.equal(authorGuards.filter(row => row.passed).length, 13);
  assert.deepEqual(authorGuards.filter(row => !row.passed).map(row => row.id), ["copy-destination-stale", "copy-destination-missing", "copy-ifnonematch-existing", "delete-ifmatch-stale"]);
  assert.equal(publicReport.guards.length, 17); assert.equal(publicReport.profile.passed, 13); assert.equal(publicReport.nativeStrictStatus, 1);
  assert.deepEqual(publicReport.guards.filter(row => !row.passed).map(row => row.id), ["copy-destination-stale", "copy-destination-missing", "copy-exclusive-existing", "delete-stale"]);
  assert.equal(publicReport.public.total, 16); assert.equal(publicReport.public.passed, 16);
  assert.deepEqual(["workflow", "guard", "refusal", "mechanical"].map(kind => publicReport.public.checks.filter(row => row.kind === kind).length), [8, 5, 2, 1]);
  assert.equal(publicReport.public.witnesses.length, 20); assert.equal(publicReport.paginationObserved, true);
  assert.equal(publicReport.authorPublic.checks.length, 9); assert.equal(publicReport.authorWitnesses.length, 6);
  assert.ok(publicReport.authorWitnesses.every(row => row.matched));
  assert.equal(publicReport.authorPublic.nativeConditionalCopy, false); assert.equal(publicReport.authorPublic.effectiveConditionalCopy, true);
  assert.equal(publicReport.authorPublic.conditionalDelete, false); assert.equal(publicReport.authorPublic.atomicRename, false);
  assert.deepEqual(publicReport.authorPublic.move, { supported: false, code: "ENOTSUP", sourcePreserved: true, targetPreserved: true });
  assert.equal(publicReport.public.guardedMove, false); assert.equal(publicReport.public.safeRmdir, false);
  audit.result = "Expected pinned profile replayed without changing or relaxing fixtures; strict native guard cohort remains red.";
} catch (error) {
  audit.failure = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  const cleanup = { services: [], activeGroups: [...activeGroups] };
  try {
    if (!setup) {
      const directory = readdirSync(scratch).map(name => join(scratch, name)).find(path => existsSync(join(path, "prepare.json")));
      if (directory) setup = json(join(directory, "prepare.json"));
    }
    for (const group of activeGroups) { try { process.kill(-group, "SIGTERM"); } catch {} }
    if (setup) {
      const binary = join(setup.directory, "minio");
      const survivors = processes(binary);
      cleanup.survivorsBeforeFallback = survivors;
      for (const row of survivors) { try { process.kill(row.pid, "SIGTERM"); } catch {} }
      if (survivors.length) await delay(5000);
      for (const row of processes(binary)) { try { process.kill(row.pid, "SIGKILL"); } catch {} }
      if (processes(binary).length) await delay(1000);
      cleanup.activeOwnedProcesses = processes(binary);
      assert.deepEqual(cleanup.activeOwnedProcesses, []);
      for (const name of ["prepare.json", "download.json", "author-service-replay.json"]) {
        if (existsSync(join(setup.directory, name))) save(name, json(join(setup.directory, name)));
      }
      const authorFile = join(setup.directory, "author-service-replay.json");
      const author = existsSync(authorFile) ? json(authorFile) : undefined;
      for (const row of author?.results ?? []) {
        const launch = row.evidence["launch.json"];
        assert.equal(launch.binary, binary);
        assert.equal(existsSync(join(row.output, "data")), false); assert.equal(existsSync(join(row.output, "home")), false);
        cleanup.services.push({ suite: row.suite, output: row.output, launch, shutdown: row.evidence["shutdown.json"], active: false });
        save(`raw-author-${row.suite}.json`, rawFiles(row.output));
      }
      const publicFile = join(setup.directory, "independent-minio/report.json");
      if (existsSync(publicFile)) {
        const report = json(publicFile); save("packed-public-service.json", report);
        for (const name of ["data", "home"]) {
          const path = join(setup.directory, "independent-minio", name);
          if (existsSync(path)) rmSync(path, { recursive: true, force: true });
          assert.equal(existsSync(path), false);
        }
        cleanup.services.push({ suite: "packed-public", output: join(setup.directory, "independent-minio"), launch: report.launch, shutdown: report.shutdown, active: false });
        save("raw-packed-native.json", rawFiles(join(setup.directory, "independent-minio/native")));
      }
      if (existsSync(binary)) {
        cleanup.binary = { path: binary, sha256: hash(readFileSync(binary)), size: statSync(binary).size };
        rmSync(binary);
      }
      cleanup.binaryRemoved = !existsSync(binary);
      if (frozenBefore) {
        audit.frozenAfter = { ...manifest(setup.source, "src"), ...manifest(setup.source, "dist"), ...Object.fromEntries(packagePaths.map(path => [path, hash(readFileSync(join(setup.source, path)))])) };
        audit.packedAfter = manifest(join(setup.consumer, "node_modules/virtual-bash"));
        assert.deepEqual(audit.frozenAfter, frozenBefore); assert.deepEqual(audit.packedAfter, packedBefore);
        audit.frozenAndPackedStable = true;
      }
    }
    audit.currentAfter = current([...sourcePaths, ...packagePaths]);
    audit.currentChangesDuringReplay = Object.keys(audit.currentBefore).filter(path => audit.currentAfter[path] !== audit.currentBefore[path]);
    audit.currentHttpMatchesOverlayAfter = sourcePaths.filter(path => path.startsWith("src/fs/s3/http/")).every(path => audit.currentAfter[path] === expectedSources[path]);
    audit.handoffInputsAfter = current(inputPaths); audit.authorInputsAfter = current(authorPaths);
    assert.deepEqual(audit.handoffInputsAfter, audit.handoffInputsBefore); assert.deepEqual(audit.authorInputsAfter, audit.authorInputsBefore);
    assert.equal(audit.currentHttpMatchesOverlayAfter, true);
    if (!audit.failure) assert.equal(cleanup.services.length, 4);
  } catch (error) {
    audit.cleanupFailure = { name: error.name, message: error.message, stack: error.stack }; process.exitCode = 1;
  }
  audit.cleanup = cleanup; audit.endedAt = new Date().toISOString();
  audit.elapsedMs = Date.parse(audit.endedAt) - Date.parse(audit.startedAt);
  audit.headAfter = git(["rev-parse", "HEAD"]).trim(); audit.statusAfter = git(["status", "--short"]);
  save("audit.json", audit);
  save("SHA256SUMS.json", manifest(resolve(evidence)));
  console.log(JSON.stringify({ evidence, result: audit.result, failure: audit.failure, cleanupFailure: audit.cleanupFailure, serviceCount: cleanup.services.length, activeOwnedProcesses: cleanup.activeOwnedProcesses, elapsedMs: audit.elapsedMs }, null, 2));
}
