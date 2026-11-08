import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../../..");
const revision = "eab1d48a90456c1c2cdeb9289b32f1ed62429137";
const output = join(owned, "evidence", "author-integration-eab1d48");
const fixture = "tests/fs/mount/identity-compatibility-review/compatibility.test.ts";
const fixtureSha256 = "9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734";
const git = (...args) => execFileSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const save = (name, value) => writeFile(join(output, name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
const ancestors = ["0bee8e7", "91d5926", "d49d9e5", "8c863cd", "d82cca9", "cd8b5c8"];
for (const ancestor of ancestors) git("merge-base", "--is-ancestor", ancestor, revision);
assert.equal(hash(git("show", `${revision}:${fixture}`)), fixtureSha256);
assert.equal(hash(await readFile(join(repository, fixture))), fixtureSha256);
const original = ["tests/fs/mount/copy-identity.test.ts"];
const required = ["tests/fs/mount/copy-identity-guards.test.ts", "tests/fs/overlay/copy-identity.test.ts"];
for (const path of [...original, ...required]) assert.equal(hash(git("show", `${revision}:${path}`)), hash(git("show", `4fa4ba9:${path}`)), path);
const sourcePaths = git("ls-tree", "-r", "--name-only", revision, "--", "src").toString().trim().split("\n");
const inputs = [...sourcePaths, fixture, ...original, ...required, "tests/fs/overlay/helpers.ts", "tests/fs/webdav/mock.ts", "package.json", "package-lock.json", "tsconfig.json"];
await mkdir(output);
await mkdir(join(owned, ".runs"), { recursive: true });
const scratch = await mkdtemp(join(owned, ".runs", "author-integration-"));
const nativeRoot = await mkdtemp("/tmp/sb-author-");
const processes = [];
const results = [];
let before;
let sourceSetSha256;
const hashes = async paths => Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(join(scratch, path)))])));

async function run(name, args) {
  const sourcesBefore = await hashes(sourcePaths);
  assert.equal(hash(JSON.stringify(sourcesBefore)), sourceSetSha256);
  const environment = { ...process.env, TMPDIR: nativeRoot, TMP: nativeRoot, TEMP: nativeRoot };
  for (const key of ["AUDIT_CASE", "DIAGNOSTIC_MUTATION", "MOUNT_IDENTITY_REVIEW_EVIDENCE", "NATIVE_IDENTITY_REVIEW_EVIDENCE", "IDENTITY_EDGE_EVIDENCE"]) delete environment[key];
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, args, { cwd: scratch, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  processes.push({ name, pid: child.pid, startedAt, ownership: "spawned by this runner only" });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout.on("data", bytes => { stdout += bytes; });
  child.stderr.on("data", bytes => { stderr += bytes; });
  const stop = signal => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  const timeout = setTimeout(() => { timedOut = true; stop("SIGTERM"); }, 120_000);
  const hardTimeout = setTimeout(() => stop("SIGKILL"), 123_000);
  const status = await new Promise((resolveStatus, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolveStatus({ code, signal })); });
  clearTimeout(timeout);
  clearTimeout(hardTimeout);
  let residualGroup = false;
  try { process.kill(-child.pid, 0); residualGroup = true; stop("SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  await save(`${name}.stdout`, stdout);
  await save(`${name}.stderr`, stderr);
  const sourcesAfter = await hashes(sourcePaths);
  assert.deepEqual(sourcesAfter, sourcesBefore);
  const counts = name === "scoped-types" ? null : Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(key => [key, Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(stdout)?.[1] ?? -1)]));
  const result = { name, revision, command: ["node", ...args], startedAt, finishedAt: new Date().toISOString(), ...status, timedOut, residualGroup, counts,
    sourceHashesBefore: sourcesBefore, sourceHashesAfter: sourcesAfter, sourceSetSha256,
    stdoutSha256: hash(stdout), stderrSha256: hash(stderr) };
  results.push(result);
  await save(`${name}.json`, result);
  console.log(JSON.stringify({ name, ...status, counts, timedOut, residualGroup }));
}

try {
  const archive = git("archive", "--format=tar", revision, ...inputs);
  execFileSync("tar", ["-xf", "-", "-C", scratch], { input: archive });
  await symlink(join(repository, "node_modules"), join(scratch, "node_modules"), "dir");
  before = await hashes(inputs);
  const sources = await hashes(sourcePaths);
  sourceSetSha256 = hash(JSON.stringify(sources));
  const configuration = { extends: "./tsconfig.json", compilerOptions: { noEmit: true }, include: ["src/fs/**/*.ts", "src/contracts/**/*.ts", fixture, ...original, ...required], exclude: [] };
  await writeFile(join(scratch, "author-integration-types.json"), `${JSON.stringify(configuration, null, 2)}\n`);
  await save("scoped-types-config.json", configuration);
  await save("manifest-before.json", { classification: "AUTHOR combined-source integration only; not Dirac independent acceptance", revision,
    requiredAncestors: ancestors.map(ancestor => git("rev-parse", ancestor).toString().trim()), fixtureSha256,
    sourceHashes: sources, inputHashes: before, sourceSetSha256, archiveSha256: hash(archive), archiveStorage: "not duplicated; reconstruct git archive from immutable revision and input list",
    node: process.version, tsx: JSON.parse(await readFile(join(repository, "node_modules/tsx/package.json"), "utf8")).version,
    typescript: JSON.parse(await readFile(join(repository, "node_modules/typescript/package.json"), "utf8")).version,
    observedMovingHead: git("rev-parse", "HEAD").toString().trim(), sourceWorktreeStatus: git("status", "--porcelain=v1", "--", "src/fs", "src/contracts", "src/commands").toString(),
    ownedStatusBefore: git("status", "--porcelain=v1", "--", relative(repository, owned)).toString(), scratch, nativeRoot, startedAt: new Date().toISOString() });
  const testArgs = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap"];
  await run("original43", [...testArgs, fixture]);
  await run("original4", [...testArgs, ...original]);
  await run("required49", [...testArgs, ...required]);
  await run("scoped-types", [join(repository, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", "author-integration-types.json"]);
  const observations = (await readFile(join(output, "original43.stdout"), "utf8")).split("\n").filter(line => line.startsWith('# {"case":')).map(line => JSON.parse(line.slice(2)));
  await save("original43.observations.json", observations);
  const after = await hashes(inputs);
  assert.deepEqual(after, before);
  assert.equal(hash(await readFile(join(repository, fixture))), fixtureSha256);
  await save("manifest-after.json", { revision, sourceHashes: await hashes(sourcePaths), inputHashes: after, sourceSetSha256, fixtureSha256, allInputsStable: true, finishedAt: new Date().toISOString() });
  await save("summary.json", { classification: "AUTHOR combined-source integration only", revision, sourceSetSha256, results: results.map(({ sourceHashesBefore, sourceHashesAfter, ...result }) => result),
    originalPositivePass: observations.filter(entry => entry.outcome?.status === "success").length,
    originalPositiveFailures: observations.filter(entry => entry.outcome && entry.outcome.status !== "success"),
    guardObservations: observations.filter(entry => !entry.outcome).length,
    originalFixtureUnchanged: true, qualificationDeltaApplied: false, noIndependentAcceptanceClaim: true });
  process.exitCode = results.every(result => result.code === 0 && !result.timedOut && !result.residualGroup) ? 0 : 1;
} catch (error) {
  await save("capture-error.json", { name: error.name, message: error.message, stack: error.stack });
  throw error;
} finally {
  await rm(scratch, { recursive: true, force: true });
  await rm(nativeRoot, { recursive: true, force: true });
  await save("cleanup.json", { runnerPid: process.pid, processes, allRecordedCommandsClosed: results.length === processes.length, residualGroups: results.filter(result => result.residualGroup).map(result => result.name),
    ownedScratchRemoved: scratch, ownedNativeRootRemoved: nativeRoot, remainingOwnedScratchEntries: await readdir(join(owned, ".runs")), noUnownedProcessesOrTempsTouched: true,
    ownedStatusAfter: git("status", "--porcelain=v1", "--", relative(repository, owned)).toString() });
}
