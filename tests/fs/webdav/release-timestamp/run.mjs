import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const own = dirname(import.meta.filename);
const repo = resolve(own, "../../../..");
const label = process.argv[2];
const requested = process.argv[3];
const overlay = process.argv.includes("--working-helper");
const regressions = process.argv.includes("--regressions");
if (!/^[a-z0-9-]+$/u.test(label ?? "") || !requested) throw new Error("usage: run.mjs LABEL COMMIT [--working-helper] [--regressions]");
const git = (...args) => execFileSync("git", args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
const source = git("rev-parse", "--verify", `${requested}^{commit}`).toString().trim();
const output = join(own, "evidence", label);
await mkdir(output, { recursive: false });
const workspace = await mkdtemp(join(own, ".work-"));
const snapshot = join(workspace, "snapshot");
const consumer = join(workspace, "consumer");
const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(workspace, "home"), TMPDIR: workspace,
  NPM_CONFIG_USERCONFIG: join(workspace, "user.npmrc"), NPM_CONFIG_GLOBALCONFIG: join(workspace, "global.npmrc"), NPM_CONFIG_CACHE: join(workspace, "npm-cache") };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const commands = [];
const closure = {};
let failure;
function run(name, command, args, cwd = workspace, required = true) {
  const result = spawnSync(command, args, { cwd, env, timeout: 120000, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  commands.push({ name, command, args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
  if (required && result.status !== 0) throw new Error(`${name}: ${result.stderr || result.stdout || result.error}`);
  return result;
}
try {
  for (const path of [snapshot, consumer, join(consumer, "node_modules/virtual-bash"), env.HOME, join(output, "inputs")]) await mkdir(path, { recursive: true });
  for (const path of [env.NPM_CONFIG_USERCONFIG, env.NPM_CONFIG_GLOBALCONFIG]) await writeFile(path, "");
  const files = ["consumer.test.mts", "example.mts", "provider.mts", "types.mts"];
  const postcondition = "tests/fs/webdav/real-service/timestamp-postcondition.test.ts";
  const archive = git("archive", source, "src", "package.json", "tsconfig.json", "tsconfig.build.json", ...files.map((file) => `tests/fs/webdav/consumer/${file}`), ...(regressions ? [postcondition] : []));
  await writeFile(join(workspace, "source.tar"), archive);
  run("extract-source", "tar", ["xf", join(workspace, "source.tar"), "-C", snapshot]);
  if (overlay) await copyFile(join(repo, "tests/fs/webdav/consumer/provider.mts"), join(snapshot, "tests/fs/webdav/consumer/provider.mts"));
  const inputs = {};
  if (regressions) {
    const bytes = await readFile(join(snapshot, postcondition));
    inputs[postcondition] = sha(bytes);
    await writeFile(join(output, "inputs/timestamp-postcondition.test.ts.txt"), bytes);
  }
  for (const file of files) {
    const bytes = await readFile(join(snapshot, "tests/fs/webdav/consumer", file));
    inputs[`tests/fs/webdav/consumer/${file}`] = sha(bytes);
    await writeFile(join(output, "inputs", `${file}.txt`), bytes);
    await writeFile(join(consumer, file), bytes);
  }
  const baseline = { source, requested, overlay, node: process.version, nodeBinarySha256: sha(await readFile(process.execPath)), archiveSha256: sha(archive), inputs,
    harnessHashes: Object.fromEntries(await Promise.all(["run.mjs", "closure-loader.mjs", "timestamps.test.mjs"].map(async (path) => [path, sha(await readFile(join(own, path)))]))),
    sourceHashes: Object.fromEntries(await Promise.all(["src/fs/webdav/webdav.ts", "src/fs/webdav/index.ts", "src/fs/webdav/xml.ts"].map(async (path) => [path, sha(await readFile(join(snapshot, path)))]))),
    compilerSha256: sha(await readFile(join(repo, "node_modules/typescript/lib/_tsc.js"))),
    movingHead: git("rev-parse", "HEAD").toString().trim(), status: git("status", "--short").toString() };
  await writeFile(join(output, "baseline.json"), JSON.stringify(baseline, null, 2));
  run("build-source", process.execPath, [join(repo, "node_modules/typescript/bin/tsc"), "-p", join(snapshot, "tsconfig.build.json"), "--typeRoots", join(repo, "node_modules/@types")]);
  const packed = JSON.parse(run("pack", "npm", ["pack", snapshot, "--ignore-scripts", "--json", "--pack-destination", consumer]).stdout)[0];
  run("extract-package", "tar", ["xf", join(consumer, packed.filename), "-C", join(consumer, "node_modules/virtual-bash"), "--strip-components=1"]);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "webdav-release-timestamp-consumer", type: "module", private: true }));
  await copyFile(join(consumer, "package.json"), join(output, "consumer-package.json"));
  await writeFile(join(output, "package.json"), JSON.stringify({ sha256: sha(await readFile(join(consumer, packed.filename))),
    package: JSON.parse(await readFile(join(consumer, "node_modules/virtual-bash/package.json"), "utf8")) }, null, 2));
  const typeArgs = [join(repo, "node_modules/typescript/bin/tsc"), "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--typeRoots", join(repo, "node_modules/@types"), "--rootDir", consumer, "--outDir", join(consumer, "emitted"), ...files.map((file) => join(consumer, file))];
  run("consumer-types", process.execPath, typeArgs, consumer);
  const typeFiles = run("consumer-type-resolution", process.execPath, [...typeArgs, "--listFilesOnly"], consumer).stdout.trim().split("\n");
  assert.ok(typeFiles.includes(join(consumer, "node_modules/virtual-bash/dist/index.d.ts")));
  assert.ok(!typeFiles.some((path) => path.startsWith(join(snapshot, "src/")) || path.startsWith(join(snapshot, "dist/"))));
  await copyFile(join(own, "closure-loader.mjs"), join(consumer, "closure-loader.mjs"));
  const executeConsumer = (name, file) => run(name, process.execPath, ["--experimental-permission", `--allow-fs-read=${consumer}`, "--allow-worker", "--experimental-loader", join(consumer, "closure-loader.mjs"), "--unhandled-rejections=strict", join(consumer, "emitted", file)], consumer, false);
  executeConsumer("original-consumer13", "consumer.test.mjs");
  if (regressions) {
    await copyFile(join(own, "timestamps.test.mjs"), join(consumer, "emitted/timestamps.test.mjs"));
    await copyFile(join(own, "timestamps.test.mjs"), join(output, "inputs/timestamps.test.mjs.txt"));
    executeConsumer("timestamp-regressions", "timestamps.test.mjs");
    const sourceTypeArgs = [join(repo, "node_modules/typescript/bin/tsc"), "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--typeRoots", join(repo, "node_modules/@types"), join(snapshot, postcondition)];
    run("postcondition-types", process.execPath, sourceTypeArgs, snapshot);
    run("unchanged-postcondition5", process.execPath, [join(repo, "node_modules/tsx/dist/cli.mjs"), "--test", join(snapshot, postcondition)], snapshot, false);
  }
  for (const command of commands) for (const match of command.stderr.matchAll(/^WEBDAV_MODULE (.+)$/gmu)) {
    const path = fileURLToPath(match[1]);
    assert.ok(path.startsWith(join(consumer, "node_modules/virtual-bash/dist/")), "runtime source fallback");
    closure[match[1]] = sha(await readFile(path));
  }
  assert.ok(Object.keys(closure).some((path) => path.endsWith("/dist/index.js")));
  assert.ok(Object.keys(closure).some((path) => path.endsWith("/dist/fs/webdav/webdav.js")));
  await writeFile(join(output, "runtime-closure.json"), JSON.stringify(closure, null, 2));
  for (const [path, expected] of Object.entries(inputs)) assert.equal(sha(await readFile(join(snapshot, path))), expected);
} catch (error) {
  failure = { message: String(error), stack: error.stack };
} finally {
  try { await writeFile(join(output, "commands.json"), JSON.stringify(commands, null, 2)); }
  finally { await rm(workspace, { recursive: true, force: true }); }
  const removed = await lstat(workspace).then(() => false, (error) => error.code === "ENOENT");
  const results = commands.filter((command) => ["original-consumer13", "timestamp-regressions", "unchanged-postcondition5"].includes(command.name)).map((command) => ({ name: command.name, status: command.status,
    counts: Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((name) => [name, Number(command.stdout.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] ?? NaN)])) }));
  const summary = { source, overlay, failure, results, runtimeModuleCount: Object.keys(closure).length, cleanup: { workspace, removed } };
  await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (failure || !removed || commands.some((command) => command.status !== 0)) process.exitCode = 1;
}
