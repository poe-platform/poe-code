import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../../..");
const revision = "b02bbe855b6b45d635b521e3dc2f31ea2b04e215";
const output = join(owned, "evidence", "final-checkpoint-b02bbe8");
const git = (...args) => execFileSync("git", args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
const hash = value => createHash("sha256").update(value).digest("hex");
const save = (name, value) => writeFile(join(output, name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
const fixture = "tests/fs/mount/identity-compatibility-review/compatibility.test.ts";
const fixtureHash = "9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734";
const requiredAncestors = ["0bee8e7", "5076b32", "745eaa6", "e8d308a", "3cf57d3", "37edad8", "a0e598b", "7bce86a", "2926891", "eb4a242"];
for (const ancestor of requiredAncestors) git("merge-base", "--is-ancestor", ancestor, revision);
assert.equal(hash(git("show", `${revision}:${fixture}`)), fixtureHash);
assert.equal(hash(await readFile(join(repository, fixture))), fixtureHash);
await mkdir(output);
await mkdir(join(owned, ".runs"), { recursive: true });
const scratch = await mkdtemp(join(owned, ".runs", "final-checkpoint-"));
const nativeRoot = await mkdtemp("/tmp/sb-final-");
const historyPaths = git("ls-tree", "-r", "--name-only", "e3acebe", "--", relative(repository, owned)).toString().trim().split("\n");
const historical = [];
for (const path of historyPaths) {
  const committed = hash(git("show", `e3acebe:${path}`));
  const current = hash(await readFile(join(repository, path)));
  assert.equal(current, committed, path);
  historical.push({ path, sha256: committed });
}
const original = ["tests/fs/mount/copy-identity.test.ts"];
const required = ["tests/fs/mount/copy-identity-guards.test.ts", "tests/fs/overlay/copy-identity.test.ts"];
for (const path of [...original, ...required]) assert.equal(hash(git("show", `${revision}:${path}`)), hash(git("show", `4fa4ba9:${path}`)), path);
assert.equal(hash(git("show", `${revision}:src/contracts/filesystem.md`)), hash(git("show", "5076b32:src/contracts/filesystem.md")));
const roots = ["src", "tests/fs", "tests/stress/adapters", "tests/stress/s3-policy", "tests/stress/remote-cancellation", "tests/integration/adapter-tools", "tests/integration/adapter-tools-diagnostics", "package.json", "package-lock.json", "tsconfig.json"];
const candidates = git("ls-tree", "-r", "--name-only", revision, "--", ...roots).toString().trim().split("\n");
const selected = candidates.filter(path => path.startsWith("src/") || ["package.json", "package-lock.json", "tsconfig.json"].includes(path)
  || path === fixture || !path.split("/").some(part => part.startsWith(".") || ["evidence", "metadata-review", "node_modules", "node-compile-cache", "identity-authority-review", "identity-compatibility-review", "mount-identity-review"].includes(part))
    && (/\.(ts|mjs)$/.test(path) || path.endsWith("/reference.json")));
assert.ok(!selected.some(path => path.includes("/identity-authority-review/")));
const adapterStress = selected.filter(path => /^tests\/stress\/adapters\/[^/]+\.test\.ts$/.test(path));
const revisedPolicy = ["tests/stress/adapters/s3-permission-profile/revised-policy.test.ts"];
const backends = ["memory", "real", "mount", "readonly", "overlay", "s3", "webdav"];
const groups = Object.fromEntries(backends.map(name => [name, selected.filter(path => path.startsWith(`tests/fs/${name}/`) && path.endsWith(".test.ts") && path !== fixture)]));
for (const files of Object.values(groups)) assert.ok(files.length > 0);
const shared = ["tests/fs/conformance/shared.test.ts"];
const policy = ["tests/stress/s3-policy/rename.test.ts", "tests/stress/s3-policy/bounded-races.test.ts"];
const diagnostics = ["tests/integration/adapter-tools-diagnostics/eight-cases.test.ts"];
const matrix = ["tests/integration/adapter-tools/matrix.test.ts"];
const results = [];
const processes = [];
let manifest;

async function command(name, argv, extra = {}) {
  const environment = { ...process.env, TMPDIR: nativeRoot, TMP: nativeRoot, TEMP: nativeRoot, ...extra };
  for (const key of ["AUDIT_CASE", "DIAGNOSTIC_MUTATION", "DIAGNOSTIC_REVISION", "DIAGNOSTIC_MATRIX_REVISION", "MOUNT_IDENTITY_REVIEW_EVIDENCE", "NATIVE_IDENTITY_REVIEW_EVIDENCE", "IDENTITY_EDGE_EVIDENCE"]) if (!(key in extra)) delete environment[key];
  const sourceBefore = Object.fromEntries(Object.entries(await hashes()).filter(([path]) => path.startsWith("src/")));
  assert.deepEqual(sourceBefore, manifest.sourceHashes);
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, argv, { cwd: scratch, env: environment, stdio: ["ignore", "pipe", "pipe"], detached: true });
  processes.push({ name, pid: child.pid, startedAt, ownership: "spawned by this checkpoint only" });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout.on("data", bytes => { stdout += bytes; });
  child.stderr.on("data", bytes => { stderr += bytes; });
  const timeout = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; } }, 180_000);
  const hardTimeout = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } }, 183_000);
  const status = await new Promise((resolveStatus, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolveStatus({ code, signal })); });
  clearTimeout(timeout);
  clearTimeout(hardTimeout);
  let residualGroup = false;
  try { process.kill(-child.pid, 0); residualGroup = true; process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  await save(`${name}.stdout`, stdout);
  await save(`${name}.stderr`, stderr);
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(stdout)?.[1] ?? -1)]));
  const sourceAfter = Object.fromEntries(Object.entries(await hashes()).filter(([path]) => path.startsWith("src/")));
  assert.deepEqual(sourceAfter, sourceBefore);
  const result = { name, sourceStability: { revision, beforeSha256: hash(JSON.stringify(sourceBefore)), afterSha256: hash(JSON.stringify(sourceAfter)), stable: true }, command: ["node", ...argv], environment: extra, startedAt, finishedAt: new Date().toISOString(), ...status, timedOut, residualGroup, counts, stdoutSha256: hash(stdout), stderrSha256: hash(stderr) };
  results.push(result);
  await save(`${name}.json`, result);
  console.log(JSON.stringify({ name, code: status.code, counts, timedOut, residualGroup }));
  return result;
}

const tests = (name, files, extra = {}) => command(name, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", ...files], extra);
async function hashes() {
  const values = {};
  for (const path of selected) values[path] = hash(await readFile(join(scratch, path)));
  return values;
}

try {
  const archive = git("archive", "--format=tar.gz", revision, ...selected);
  await writeFile(join(output, "source-b02bbe8.tar.gz"), archive);
  execFileSync("tar", ["-xzf", join(output, "source-b02bbe8.tar.gz"), "-C", scratch]);
  await symlink(join(repository, "node_modules"), join(scratch, "node_modules"), "dir");
  await mkdir(join(scratch, ".fixtures"));
  const before = await hashes();
  manifest = { revision, mandatoryAncestors: requiredAncestors.map(short => git("rev-parse", short).toString().trim()), contractRevision: git("rev-parse", "5076b32").toString().trim(), archiveSha256: hash(archive), fixtureSha256: fixtureHash,
    sourceHashes: Object.fromEntries(Object.entries(before).filter(([path]) => path.startsWith("src/"))), inputHashes: before,
    sourceSetSha256: hash(JSON.stringify(Object.fromEntries(Object.entries(before).filter(([path]) => path.startsWith("src/"))))),
    groups, original, required, shared, policy, diagnostics, matrix, adapterStress, revisedPolicy, nativeRoot, node: process.version,
    tsx: JSON.parse(await readFile(join(repository, "node_modules/tsx/package.json"), "utf8")).version,
    typescript: ts.version, historical, observedMovingHead: git("rev-parse", "HEAD").toString().trim(), ownedStatusBefore: git("status", "--porcelain=v1", "--", relative(repository, owned)).toString(),
    sourceWorktreeStatusAtCapture: git("status", "--porcelain=v1", "--", "src/fs", "src/contracts", "src/commands").toString(), startedAt: new Date().toISOString(), scratch };
  await save("manifest-before.json", manifest);
  await save("original43.fixture.ts.txt", await readFile(join(scratch, fixture), "utf8"));
  await save("original-guard-hashes.json", Object.fromEntries([...original, ...required].map(path => [path, before[path]])));
  await tests("original43", [fixture]);
  await tests("original4", original);
  await tests("required49", required);
  for (const name of backends) await tests(`backend-${name}`, groups[name]);
  await tests("shared-conformance", shared);
  await tests("s3-policy86", policy);
  await command("remote-cancellation24", ["tests/stress/remote-cancellation/run.mjs"], { AUDIT_REPEATS: "1", AUDIT_VERBOSE: "1" });
  await tests("diagnostics8", diagnostics, { DIAGNOSTIC_REVISION: revision, DIAGNOSTIC_MATRIX_REVISION: revision });
  await tests("required-preflight-matrix79", matrix);
  await tests("live-adapter-stress", adapterStress);
  await tests("approved-s3-permission-policy", revisedPolicy);
  const typedEntries = [...Object.values(groups).flat(), fixture, ...shared, ...policy, ...diagnostics, ...matrix, ...adapterStress, ...revisedPolicy, "tests/stress/remote-cancellation/remote-cancellation.test.ts"];
  const configuration = { extends: "./tsconfig.json", compilerOptions: { noEmit: true }, include: ["src/contracts/**/*.ts", "src/fs/**/*.ts", ...typedEntries], exclude: [] };
  await writeFile(join(scratch, "checkpoint-types.json"), `${JSON.stringify(configuration, null, 2)}\n`);
  await save("scoped-types-config.json", configuration);
  await command("scoped-fs-types", [join(repository, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", "checkpoint-types.json"]);
  const afterAcceptance = await hashes();
  assert.deepEqual(afterAcceptance, before, "every frozen source/input file must remain unchanged after acceptance gates");
  await save("acceptance-stability.json", { stable: true, inputCount: selected.length, inputHashes: afterAcceptance });

  const originalFixture = await readFile(join(scratch, fixture), "utf8");
  const replacements = [
    ['import { MockS3Client, S3FileSystem }', 'import { createS3Transport, MockS3Client, S3FileSystem, type S3Client }'],
    ['const make = (transport: typeof service)', 'const make = (transport: S3Client)'],
    ['const firstClient = opaque(service);', 'const firstClient = createS3Transport(service, service.capabilities);'],
    ['const secondClient = opaque(service);', 'const secondClient = createS3Transport(service, service.capabilities);'],
    ['const firstClient = { fetch: (url: string, init: RequestInit) => service.fetch(url, init) };', 'const firstClient = { fetch: service.createFetch() };'],
    ['const secondClient = { fetch: (url: string, init: RequestInit) => service.fetch(url, init) };', 'const secondClient = { fetch: service.createFetch() };'],
  ];
  let qualified = originalFixture;
  for (const [from, to] of replacements) { assert.equal(qualified.split(from).length, 2); qualified = qualified.replace(from, to); }
  const assertions = source => {
    const parsed = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
    const calls = [];
    const visit = node => { if (ts.isCallExpression(node) && node.expression.getText(parsed).startsWith("assert.")) calls.push(node.getText(parsed)); ts.forEachChild(node, visit); };
    visit(parsed);
    return calls;
  };
  assert.deepEqual(assertions(qualified), assertions(originalFixture));
  await save("diagnostic-qualified.fixture.ts.txt", qualified);
  const originalLines = originalFixture.split("\n");
  const qualifiedLines = qualified.split("\n");
  const diff = originalLines.flatMap((line, index) => line === qualifiedLines[index] ? [] : [`@@ line ${index + 1} @@`, `-${line}`, `+${qualifiedLines[index]}`]).join("\n") + "\n";
  await save("diagnostic-qualified-input.diff", diff);
  await save("diagnostic-qualified-input.json", { originalSha256: hash(originalFixture), diagnosticSha256: hash(qualified), assertionsByteIdentical: true, assertionCallCount: assertions(qualified).length, replacements, interpretation: "Diagnostic only; no original acceptance replacement. User-approved helper typing changes typeof service to the exported S3Client interface; no cast or assertion changes." });
  const patchLines = ["*** Begin Patch", `*** Update File: ${fixture}`, ...originalLines.flatMap((line, index) => line === qualifiedLines[index] ? [] : ["@@", `-${line}`, `+${qualifiedLines[index]}`]), "*** End Patch", ""].join("\n");
  execFileSync("apply_patch", [], { cwd: scratch, input: patchLines });
  await tests("diagnostic-qualified43", [fixture]);
  await writeFile(join(scratch, "diagnostic-types.json"), `${JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: true }, include: [fixture], exclude: [] }, null, 2)}\n`);
  await command("diagnostic-qualified-types", [join(repository, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", "diagnostic-types.json"]);
  const restore = ["*** Begin Patch", `*** Update File: ${fixture}`, ...originalLines.flatMap((line, index) => line === qualifiedLines[index] ? [] : ["@@", `-${qualifiedLines[index]}`, `+${line}`]), "*** End Patch", ""].join("\n");
  execFileSync("apply_patch", [], { cwd: scratch, input: restore });
  const after = await hashes();
  assert.deepEqual(after, before);
  for (const entry of historical) assert.equal(hash(await readFile(join(repository, entry.path))), entry.sha256, entry.path);
  for (const name of ["original43", "diagnostic-qualified43"]) {
    const text = await readFile(join(output, `${name}.stdout`), "utf8");
    const observations = text.split("\n").filter(line => line.startsWith('# {"case":')).map(line => JSON.parse(line.slice(2)));
    await save(`${name}.observations.json`, observations);
  }
  await save("manifest-after.json", { revision, finishedAt: new Date().toISOString(), inputHashes: after, stable: true, historicalFilesUnchanged: historical.length, liveFixtureSha256: hash(await readFile(join(repository, fixture))) });
  await save("summary.json", { revision, sourceSetSha256: manifest.sourceSetSha256, archiveSha256: manifest.archiveSha256, results, countsMustNotBeSummedAcrossOverlappingCohorts: true });
  process.exitCode = results.every(result => result.code === 0 && !result.timedOut && !result.residualGroup) ? 0 : 1;
} catch (error) {
  await save("capture-error.json", { name: error.name, message: error.message, stack: error.stack, results });
  throw error;
} finally {
  await rm(scratch, { recursive: true, force: true });
  await rm(nativeRoot, { recursive: true, force: true });
  await save("leaf-process-cleanup.json", { runnerPid: process.pid, processes, allRecordedCommandsClosed: results.length === processes.length, residualGroups: results.filter(result => result.residualGroup), scratchRemoved: true, ownedNativeRoot: nativeRoot, ownedNativeRootRemoved: true, noOtherWorkersInspectedOrSignaled: true, ownedStatusAtCloseout: git("status", "--porcelain=v1", "--", relative(repository, owned)).toString(), remainingOwnedScratchEntries: await readdir(join(owned, ".runs")) });
}
