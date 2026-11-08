import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const own = dirname(import.meta.filename);
const repo = resolve(own, "../../../..");
const [label, requested, profile = "candidate"] = process.argv.slice(2);
assert.match(label ?? "", /^[a-z0-9-]+$/u);
assert.ok(requested, "usage: node run.mjs NEW_LABEL COMMIT [candidate|original|red]");
assert.ok(["candidate", "original", "red"].includes(profile));
const helperCommit = "456a0738b0d2dc130ebbd9b7ccf5e299bcf177da";
const originalCommit = "02a78bf64c29dedcd69071551ed5848b0765c107";
const git = (...args) => execFileSync("git", args, { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
const source = git("rev-parse", "--verify", `${requested}^{commit}`).toString().trim();
const output = join(own, "evidence", label);
await mkdir(output, { recursive: false });
const workspace = await mkdtemp(join(own, ".work-"));
const snapshot = join(workspace, "snapshot");
const consumer = join(workspace, "consumer");
const packageRoot = join(consumer, "node_modules/virtual-bash");
const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(workspace, "home"), TMPDIR: workspace,
  NPM_CONFIG_USERCONFIG: join(workspace, "user.npmrc"), NPM_CONFIG_GLOBALCONFIG: join(workspace, "global.npmrc"), NPM_CONFIG_CACHE: join(workspace, "npm-cache") };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const commands = [];
const closures = {};
const started = new Date().toISOString();
let failure;
let protectedBefore;
let protectedAfter;
const capture = async (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + "\n");
function run(name, binary, args, cwd = workspace, required = true) {
  const result = spawnSync(binary, args, { cwd, env, encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  commands.push({ name, binary, args, cwd, status: result.status, signal: result.signal, error: result.error?.message,
    stdout: result.stdout, stderr: result.stderr });
  if (required && result.status !== 0) throw new Error(`${name}: ${result.stderr || result.stdout || result.error}`);
  return result;
}
async function seal(paths) {
  const hashes = {};
  for (const path of paths) hashes[path] = sha(await readFile(join(repo, path)));
  return hashes;
}
const tracked = git("ls-files", "-z", "tests/fs/webdav", "src/fs/webdav", "src/contracts", "package.json", "tsconfig.json", "tsconfig.build.json", "scripts/verify-qualified-release.mjs").toString().split("\0").filter(Boolean);
const protectedPaths = tracked.filter(path => !path.startsWith("tests/fs/webdav/release-timestamp-independent/") && !path.startsWith("tests/fs/webdav/release-timestamp/"));
const rawHistorical = git("ls-files", "-z", "tests/fs/webdav/release-timestamp/evidence/exact-failed", "tests/fs/webdav/release-timestamp/evidence/current-before", "tests/fs/webdav/release-timestamp/evidence/regression-before").toString().split("\0").filter(Boolean);
protectedPaths.push(...rawHistorical);
try {
  protectedBefore = await seal(protectedPaths);
  await capture("protected-before.json", protectedBefore);
  for (const path of [snapshot, consumer, packageRoot, env.HOME, join(output, "inputs")]) await mkdir(path, { recursive: true });
  for (const path of [env.NPM_CONFIG_USERCONFIG, env.NPM_CONFIG_GLOBALCONFIG]) await writeFile(path, "");
  const files = ["consumer.test.mts", "example.mts", "provider.mts", "types.mts"];
  const postcondition = "tests/fs/webdav/real-service/timestamp-postcondition.test.ts";
  const archivePaths = ["src", "package.json", "tsconfig.json", "tsconfig.build.json", ...files.map(file => `tests/fs/webdav/consumer/${file}`), postcondition];
  const archive = git("archive", source, ...archivePaths);
  await writeFile(join(workspace, "source.tar"), archive);
  run("extract-source", "tar", ["xf", join(workspace, "source.tar"), "-C", snapshot]);
  const fixtureHashes = {};
  for (const file of files) {
    const path = `tests/fs/webdav/consumer/${file}`;
    const bytes = await readFile(join(snapshot, path));
    fixtureHashes[path] = sha(bytes);
    if (file !== "provider.mts") assert.equal(sha(bytes), sha(git("show", `${originalCommit}:${path}`)), `${file} original seal`);
    if (file === "provider.mts" && profile === "candidate") assert.equal(sha(bytes), sha(git("show", `${helperCommit}:${path}`)), "candidate must load exact helper456");
    await writeFile(join(consumer, file), bytes);
    await writeFile(join(output, "inputs", `${file}.txt`), bytes);
  }
  const sourcePaths = git("ls-tree", "-r", "--name-only", source, "src").toString().trim().split("\n");
  const sourceHashes = {};
  for (const path of sourcePaths) sourceHashes[path] = sha(await readFile(join(snapshot, path)));
  for (const path of ["src/fs/webdav/webdav.ts", "src/fs/webdav/xml.ts", "src/fs/webdav/index.ts", postcondition]) {
    assert.equal(sha(await readFile(join(snapshot, path))), sha(git("show", `${originalCommit}:${path}`)), `${path} unchanged since failing source`);
  }
  await capture("baseline.json", { source, requested, profile, helperCommit, originalCommit, started,
    movingHead: git("rev-parse", "HEAD").toString().trim(), status: git("status", "--short").toString(),
    node: process.version, nodeBinarySha256: sha(await readFile(process.execPath)), compilerSha256: sha(await readFile(join(repo, "node_modules/typescript/lib/_tsc.js"))),
    archiveSha256: sha(archive), fixtureHashes, sourceHashes,
    harnessHashes: Object.fromEntries(await Promise.all(["run.mjs", "closure-loader.mjs", "independent.test.mts"].map(async path => [path, sha(await readFile(join(own, path)))]))) });
  run("isolated-build", process.execPath, [join(repo, "node_modules/typescript/bin/tsc"), "-p", join(snapshot, "tsconfig.build.json"), "--typeRoots", join(repo, "node_modules/@types")]);
  const packed = JSON.parse(run("pack", "npm", ["pack", snapshot, "--ignore-scripts", "--json", "--pack-destination", consumer]).stdout)[0];
  run("extract-package", "tar", ["xf", join(consumer, packed.filename), "-C", packageRoot, "--strip-components=1"]);
  const boundary = { name: "webdav-independent-timestamp-verifier", type: "module", private: true };
  await writeFile(join(consumer, "package.json"), JSON.stringify(boundary));
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.notEqual(boundary.name, manifest.name);
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
  await capture("package.json", { consumer: boundary, packedSha256: sha(await readFile(join(consumer, packed.filename))), product: manifest });
  if (profile === "candidate") {
    await copyFile(join(own, "independent.test.mts"), join(consumer, "independent.test.mts"));
    await copyFile(join(own, "independent.test.mts"), join(output, "inputs/independent.test.mts.txt"));
  }
  const strict = ["--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node", "--typeRoots", join(repo, "node_modules/@types")];
  const typeArgs = [join(repo, "node_modules/typescript/bin/tsc"), ...strict, "--rootDir", consumer, "--outDir", join(consumer, "emitted"), ...files.map(file => join(consumer, file)), ...(profile === "candidate" ? [join(consumer, "independent.test.mts")] : [])];
  run("strict-consumer-types", process.execPath, typeArgs, consumer);
  const resolution = run("declaration-resolution", process.execPath, [...typeArgs, "--listFilesOnly"], consumer).stdout.trim().split("\n");
  assert.ok(resolution.includes(join(packageRoot, "dist/index.d.ts")));
  assert.ok(!resolution.some(path => path.startsWith(join(snapshot, "src/")) || path.startsWith(join(repo, "dist/")) || path.startsWith(join(snapshot, "dist/"))));
  await copyFile(join(own, "closure-loader.mjs"), join(consumer, "closure-loader.mjs"));
  const execute = (name, file) => run(name, process.execPath, ["--experimental-permission", `--allow-fs-read=${consumer}`, "--allow-worker", "--experimental-loader", join(consumer, "closure-loader.mjs"), "--unhandled-rejections=strict", join(consumer, "emitted", file)], consumer, false);
  execute("original-consumer13", "consumer.test.mjs");
  if (profile !== "original") {
    const authorTests = git("show", `${helperCommit}:tests/fs/webdav/release-timestamp/timestamps.test.mjs`);
    await writeFile(join(consumer, "emitted/author-regressions.mjs"), authorTests);
    await writeFile(join(output, "inputs/author-regressions.mjs.txt"), authorTests);
    execute("author-regressions19", "author-regressions.mjs");
  }
  if (profile === "candidate") {
    execute("independent-controls", "independent.test.mjs");
    await copyFile(join(snapshot, postcondition), join(output, "inputs/postcondition.test.ts.txt"));
    run("strict-postcondition-types", process.execPath, [join(repo, "node_modules/typescript/bin/tsc"), ...strict, "--noEmit", join(snapshot, postcondition)], snapshot);
    run("unchanged-postcondition5", process.execPath, [join(repo, "node_modules/tsx/dist/cli.mjs"), "--test", join(snapshot, postcondition)], snapshot, false);
  }
  for (const command of commands) {
    const closure = {};
    for (const match of (command.stderr ?? "").matchAll(/^INDEPENDENT_MODULE (.+)$/gmu)) {
      const entry = JSON.parse(match[1]);
      const path = fileURLToPath(entry.url);
      assert.ok(path.startsWith(join(packageRoot, "dist/")));
      assert.equal(sha(await readFile(path)), entry.sha256);
      closure[entry.url] = entry.sha256;
    }
    if (Object.keys(closure).length) {
      assert.ok(Object.keys(closure).some(path => path.endsWith("/dist/index.js")));
      assert.ok(Object.keys(closure).some(path => path.endsWith("/dist/fs/webdav/webdav.js")));
      closures[command.name] = closure;
    }
  }
  assert.ok(closures["original-consumer13"]);
  await capture("runtime-closures.json", closures);
  for (const [path, hash] of Object.entries(sourceHashes)) assert.equal(sha(await readFile(join(snapshot, path))), hash);
  for (const [path, hash] of Object.entries(fixtureHashes)) assert.equal(sha(await readFile(join(snapshot, path))), hash);
} catch (error) {
  failure = { message: String(error), stack: error.stack };
} finally {
  try {
    protectedAfter = await seal(protectedPaths);
    await capture("protected-after.json", protectedAfter);
    assert.deepEqual(protectedAfter, protectedBefore, "read-only original/provider/evidence seals changed during replay");
  } catch (error) { failure ??= { message: String(error), stack: error.stack }; }
  await capture("commands.json", commands);
  await rm(workspace, { recursive: true, force: true });
  const removed = await lstat(workspace).then(() => false, error => error.code === "ENOENT");
  const results = commands.filter(command => ["original-consumer13", "author-regressions19", "independent-controls", "unchanged-postcondition5"].includes(command.name)).map(command => ({ name: command.name, status: command.status,
    counts: Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(name => [name, Number(command.stdout?.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] ?? NaN)])) }));
  const summary = { source, requested, profile, helperCommit, started, finished: new Date().toISOString(), failure, results,
    mutantKills: commands.find(command => command.name === "independent-controls")?.stdout.match(/MUTANT_KILLED [a-z-]+/gu) ?? [],
    loadedModuleCounts: Object.fromEntries(Object.entries(closures).map(([name, closure]) => [name, Object.keys(closure).length])),
    protectedFiles: protectedPaths.length, historicalRawFiles: rawHistorical.length, cleanup: { workspace, removed } };
  await capture("summary.json", summary);
  console.log(JSON.stringify(summary, null, 2));
  if (failure || !removed || commands.some(command => command.status !== 0)) process.exitCode = 1;
}
