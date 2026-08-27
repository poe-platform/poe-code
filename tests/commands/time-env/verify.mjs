import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { supervise } from "../../integration/full-gate-20260827/supervise.mjs";

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, "../../..");
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
assert.ok(process.argv[2], "explicit committed source required");
const commit = git("rev-parse", `${process.argv[2]}^{commit}`).toString().trim();
const label = process.argv[3] ?? "frozen";
assert.match(label, /^[a-zA-Z0-9-]+$/);
const evidence = join(owned, "evidence", label);
await mkdir(dirname(evidence), { recursive: true });
await mkdir(evidence);
const scratch = await mkdtemp("/tmp/safe-bash-time-env-frozen-");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const save = (path, value) => writeFile(path, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
async function hashes(directory, prefix = "") {
  const result = {};
  for (const name of (await readdir(join(directory, prefix))).sort()) {
    const path = join(prefix, name), stat = await lstat(join(directory, path));
    assert.equal(stat.isSymbolicLink(), false, path);
    if (stat.isDirectory()) Object.assign(result, await hashes(directory, path));
    else result[path] = hash(await readFile(join(directory, path)));
  }
  return result;
}
const results = {};
const execute = async (name, args) => {
  const result = await supervise(process.execPath, args, { cwd: scratch,
    env: { PATH: "/usr/bin:/bin", HOME: scratch, TMPDIR: join(scratch, "tmp"), TZ: "UTC", LC_ALL: "C", LANG: "C", TSX_DISABLE_CACHE: "1" },
    stdout: join(evidence, `${name}.stdout`), stderr: join(evidence, `${name}.stderr`), timeoutMs: 120000, maxOutputBytes: 8 * 1024 * 1024 });
  const stdout = await readFile(join(evidence, `${name}.stdout`), "utf8");
  result.counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  result.stdoutSha256 = hash(stdout); result.stderrSha256 = hash(await readFile(join(evidence, `${name}.stderr`)));
  await save(join(evidence, `${name}.json`), result);
  assert.equal(result.timedOut, false); assert.equal(result.outputExceeded, false); assert.deepEqual(result.survivors, []);
  results[name] = result;
  console.log(name, result.status, result.counts);
  return result;
};
let manifest;
try {
  const paths = git("ls-tree", "-r", "--name-only", commit).toString().trim().split("\n").filter(path => path.startsWith("src/")
    || (path.startsWith("tests/commands/time-env/") && !path.includes("/evidence/"))
    || ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"].includes(path));
  const archive = git("archive", "--format=tar", commit, "--", ...paths);
  execFileSync("/usr/bin/tar", ["-xf", "-", "-C", scratch], { input: archive });
  const inputs = await hashes(scratch);
  assert.equal(hash(await readFile(join(root, "package-lock.json"))), inputs["package-lock.json"]);
  await cp(join(root, "node_modules"), join(scratch, "node_modules"), { recursive: true, dereference: true });
  const dependencies = await hashes(join(scratch, "node_modules"));
  const native = {};
  const oracleRoot = "tests/commands/metadata-stress/.oracle/coreutils-9.7";
  for (const path of ["src/date", "src/sleep", "src/printenv", "src/date.c", "src/sleep.c", "src/printenv.c", "lib/long-options.c"]) {
    const source = join(root, oracleRoot, path), target = join(scratch, oracleRoot, path);
    native[path] = hash(await readFile(source));
    await mkdir(dirname(target), { recursive: true }); await cp(source, target, { dereference: true });
    assert.equal(hash(await readFile(target)), native[path]);
  }
  const provenance = JSON.parse(await readFile(join(root, "tests/commands/metadata-stress/oracle-evidence.json"), "utf8"));
  const archivePath = join(root, "tests/commands/metadata-stress/.oracle/coreutils-9.7.tar.xz");
  assert.equal(hash(await readFile(archivePath)), provenance.archiveSha256);
  for (const path of ["src/date.c", "src/sleep.c", "src/printenv.c", "lib/long-options.c"]) {
    const original = execFileSync("/usr/bin/tar", ["-xOf", archivePath, `coreutils-9.7/${path}`]);
    assert.equal(hash(original), native[path], `official archive source match ${path}`);
  }
  await mkdir(join(scratch, "tmp"));
  manifest = { commit, archiveSha256: hash(archive), sourceHashes: inputs, dependencies, native, primarySource: provenance.sourceUrl,
    primaryArchiveSha256: provenance.archiveSha256, scratch, node: process.version, platform: process.platform, arch: process.arch,
    startedAt: new Date().toISOString(), movingHead: git("rev-parse", "HEAD").toString().trim(), movingStatus: git("status", "--porcelain=v1").toString() };
  await save(join(evidence, "manifest-before.json"), manifest);
  const tests = paths.filter(path => path.startsWith("tests/commands/time-env/") && path.endsWith(".test.ts"));
  await execute("suite", ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-timeout=30000", ...tests]);
  await execute("scoped-types", ["node_modules/typescript/bin/tsc", "-p", "tests/commands/time-env/tsconfig.json", "--noEmit"]);
  await execute("build", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"]);
  await execute("built-consumer", ["tests/commands/time-env/built.mjs"]);
  await save(join(scratch, "consumer.mts"), `import {createTimeEnvCommands,timeEnvCommands,type TimeEnvCommandsOptions} from './dist/commands/time-env/index.js';\nimport type {CommandDefinition,VirtualShellPlugin} from './dist/contracts/index.js';\nconst options:TimeEnvCommandsOptions={clock:()=>0,defaultTimeZone:'UTC',limits:{maxArguments:4},scheduler:{now:()=>0,setTimeout:()=>0,clearTimeout:()=>{}}};\nconst commands:readonly CommandDefinition[]=createTimeEnvCommands(options);\nconst plugin:VirtualShellPlugin=timeEnvCommands(options);\nvoid [commands,plugin];\n`);
  const typeArgs = ["node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--skipLibCheck", "false"];
  await execute("consumer-types", [...typeArgs, "consumer.mts"]);
  await save(join(scratch, "negative.mts"), `import {createTimeEnvCommands} from './dist/commands/time-env/index.js';\ncreateTimeEnvCommands({clock:()=>''});\ncreateTimeEnvCommands({scheduler:{now:()=>0,setTimeout:()=>0}});\ncreateTimeEnvCommands({limits:{maxOutputBytes:'1'}});\n`);
  await execute("negative-types", [...typeArgs, "negative.mts"]);
  const diagnostics = await readFile(join(evidence, "negative-types.stdout"), "utf8");
  assert.equal((diagnostics.match(/error TS2322/g) ?? []).length, 2); assert.equal((diagnostics.match(/error TS2741/g) ?? []).length, 1);
  assert.equal((diagnostics.match(/error TS\d+/g) ?? []).length, 3);
  await execute("native-profile", ["--import", "tsx", "tests/commands/time-env/capture-native.mjs", join(evidence, "dialect-profile.json")]);
  for (const [path, expected] of Object.entries(inputs)) assert.equal(hash(await readFile(join(scratch, path))), expected, path);
  assert.deepEqual(await hashes(join(scratch, "node_modules")), dependencies);
  for (const [path, expected] of Object.entries(native)) {
    assert.equal(hash(await readFile(join(root, oracleRoot, path))), expected);
    assert.equal(hash(await readFile(join(scratch, oracleRoot, path))), expected);
  }
  await save(join(evidence, "manifest-after.json"), { ...manifest, finishedAt: new Date().toISOString(), sourceInputsUnchanged: true, dependenciesUnchanged: true,
    buildHashes: await hashes(join(scratch, "dist")), statuses: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.status])) });
  for (const [name, result] of Object.entries(results)) assert.equal(result.status, name === "negative-types" ? 2 : 0, name);
} finally {
  await rm(scratch, { recursive: true });
  await save(join(evidence, "cleanup.json"), { removed: scratch, finishedAt: new Date().toISOString(), processSurvivors: Object.values(results).flatMap(result => result.survivors) });
}
