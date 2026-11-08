import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const owned = "tests/commands/archive-stress/pax-deletion-evidence";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const author = ["boundaries", "core", "lifecycle", "native", "options", "safety"].map(name => `tests/commands/archive/${name}.test.ts`);
const stress = ["acceptance", "native", "long-link-regression", "limits-effects", "hardlink-identity", "pax-extensibility", "pax-native"].map(name => `tests/commands/archive-stress/${name}.test.ts`);
const old177 = [...author, "tests/commands/archive/aggregate-integration.test.ts", ...stress, "tests/commands/archive-stress/pax-independent/controls.test.ts"];
const historicalFixtures = ["BSD-native.tar", "BSD-native.tar.gz"].map(name => `tests/commands/archive-stress/final-evidence/gate-3ecvdu/${name}`);
const environment = { ...process.env, NODE_PATH: "", TSX_DISABLE_CACHE: "1", LC_ALL: "C", TZ: "UTC" };
for (const name of Object.keys(environment)) if (/^(?:ARCHIVE_|TS_NODE_|NODE_OPTIONS$|ESBUILD_BINARY_PATH$|TSX_TSCONFIG_PATH$|TSX_PROJECT$)/u.test(name)) delete environment[name];
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const gitState = () => ({ head: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain=v1", "--untracked-files=all"), staged: git("diff", "--cached", "--raw") });
async function pathsUnder(base, prefix = "") {
  const paths = [];
  for (const entry of await readdir(join(base, prefix), { withFileTypes: true })) {
    if ([".bin", ".cache"].includes(entry.name)) continue;
    const path = join(prefix, entry.name);
    assert.ok(!entry.isSymbolicLink(), `input alias rejected: ${path}`);
    if (entry.isDirectory()) paths.push(...await pathsUnder(base, path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths.sort();
}
async function inputs() {
  const paths = [...(await pathsUnder(join(root, "src"))).map(path => `src/${path}`), ...(await pathsUnder(join(root, "node_modules"))).map(path => `node_modules/${path}`)];
  for (const directory of ["tests/commands/archive", "tests/commands/archive-stress", "tests/commands/archive-stress/pax-independent"]) {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith(".ts")) paths.push(`${directory}/${entry.name}`);
  }
  paths.push("package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar", `${owned}/tsconfig.scope.json`, `${owned}/run.mjs`, ...historicalFixtures);
  return paths.sort();
}
async function manifest(base, paths, isolated = false) {
  const files = [];
  for (const path of paths) {
    const metadata = await lstat(join(base, path));
    assert.ok(metadata.isFile() && (!isolated || metadata.nlink === 1), `not a regular independent input: ${path}`);
    files.push({ path, bytes: metadata.size, mode: metadata.mode & 0o777, sha256: digest(await readFile(join(base, path))) });
  }
  return { sha256: digest(JSON.stringify(files)), files };
}
async function copy(base, tree, path) {
  const from = join(base, path), to = join(tree, path);
  const metadata = await lstat(from);
  assert.ok(metadata.isFile(), `source alias rejected: ${from}`);
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, await readFile(from));
  await chmod(to, metadata.mode & 0o777);
  const copied = await lstat(to);
  assert.ok(copied.nlink === 1 && (metadata.dev !== copied.dev || metadata.ino !== copied.ino), `source identity reused: ${path}`);
}
const [action, input, label] = process.argv.slice(2);
if (["seal", "overlay", "refresh-baseline"].includes(action)) {
  const temporary = await mkdtemp("/tmp/safe-bash-pax-deletion-");
  const tree = join(temporary, "tree");
  const stateBefore = gitState();
  const previous = action !== "seal" ? JSON.parse(await readFile(join(resolve(input), "../seal.json"), "utf8")) : undefined;
  const base = previous ? resolve(input) : root;
  const paths = previous ? previous.inputs.files.map(file => file.path) : await inputs();
  if (previous) assert.deepEqual(await manifest(base, paths, true), previous.inputs, "previous frozen inputs drifted");
  const before = await manifest(base, paths);
  for (const path of paths) await copy(base, tree, path);
  assert.deepEqual(await manifest(base, paths), before, "copy input drift");
  const overlays = previous ? paths.filter(path => (action === "overlay" && (path.startsWith("src/commands/archive/") || path === "tests/commands/archive/options.test.ts")) || path === "tests/commands/archive/pax-deletion.test.ts" || path === `${owned}/run.mjs`) : [];
  for (const path of historicalFixtures) if (!paths.includes(path)) { paths.push(path); overlays.push(path); }
  paths.sort();
  const overlayBefore = await manifest(root, overlays);
  for (const path of overlays) await copy(root, tree, path);
  assert.deepEqual(await manifest(root, overlays), overlayBefore, "overlay input drift");
  const captured = await manifest(tree, paths, true);
  const lock = JSON.parse(await readFile(join(tree, "package-lock.json"), "utf8"));
  const dependencyVersions = [];
  for (const [path, metadata] of Object.entries(lock.packages)) {
    if (!path || !captured.files.some(file => file.path === `${path}/package.json`)) continue;
    const installed = JSON.parse(await readFile(join(tree, path, "package.json"), "utf8"));
    assert.equal(installed.version, metadata.version, `locked dependency version mismatch: ${path}`);
    dependencyVersions.push({ path, version: installed.version, lockIntegrity: metadata.integrity });
  }
  assert.equal(captured.files.find(file => file.path.endsWith("/bin/gtar")).sha256, "49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66");
  await writeFile(join(temporary, "seal.json"), JSON.stringify({ tree, node: process.version, stateBefore, stateAfter: gitState(), base, previousHash: previous?.inputs.sha256, overlays: overlayBefore, inputs: captured, dependencyVersions, aliases: 0, retained: true }, null, 2));
  console.log(tree);
} else if (action === "run") {
  const tree = resolve(input);
  const seal = JSON.parse(await readFile(join(tree, "../seal.json"), "utf8"));
  const paths = seal.inputs.files.map(file => file.path);
  assert.deepEqual(await manifest(tree, paths, true), seal.inputs, "sealed input drift before run");
  const cohort = label === "old177" || label === "corrected177" ? old177 : label === "targets12" ? ["tests/commands/archive/pax-deletion.test.ts"] : undefined;
  assert.ok(cohort || label === "types", "expected old177, corrected177, targets12 or types");
  if (label === "old177") assert.equal(digest(await readFile(join(tree, "tests/commands/archive/options.test.ts"))), "34e3aa6ac71cc7078371502255c7880994ef0644ecf00dc8da351e785532d66f", "old177 requires the literal legacy oracle");
  const args = cohort ? ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-timeout=20000", "--test-concurrency=1", ...cohort] : ["node_modules/typescript/bin/tsc", "--pretty", "false", "-p", `${owned}/tsconfig.scope.json`];
  const started = new Date().toISOString();
  const result = await new Promise((complete, reject) => {
    const child = spawn(process.execPath, args, { cwd: tree, env: { ...environment, TMPDIR: dirname(tree), ARCHIVE_LONG_LINK_NATIVE: "1", ARCHIVE_ACCEPTANCE_SOURCE: join(tree, "src/commands/archive/index.ts") }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    let bytes = 0, error;
    const stop = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch (failure) { if (failure.code !== "ESRCH") throw failure; } } };
    const timer = setTimeout(() => { error = new Error("subprocess deadline"); stop(); }, 180000);
    const interrupt = () => { stop(); process.exit(130); };
    process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
    const collect = destination => chunk => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) { error = new Error("subprocess output bound"); stop(); }
      else destination.push(Buffer.from(chunk));
    };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    child.once("error", reject);
    child.once("close", (status, signal) => {
      clearTimeout(timer); stop();
      process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
      complete({ status, signal, error, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
  const stdout = result.stdout ?? Buffer.alloc(0), stderr = result.stderr ?? Buffer.alloc(0);
  await writeFile(join(tree, `../${label}.tap`), stdout, { flag: "wx" });
  await writeFile(join(tree, `../${label}.stderr`), stderr, { flag: "wx" });
  const counts = Object.fromEntries([...stdout.toString().matchAll(/^# (tests|pass|fail|cancelled|skipped) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  const unchanged = JSON.stringify(await manifest(tree, paths, true)) === JSON.stringify(seal.inputs);
  const record = { started, finished: new Date().toISOString(), executable: process.execPath, args, cwd: tree, sourceHash: seal.inputs.sha256, timeoutMs: 180000, maxOutputBytes: 16 * 1024 * 1024, status: result.status, signal: result.signal, error: result.error?.message, counts, unchanged, stdoutSha256: digest(stdout), stderrSha256: digest(stderr) };
  await writeFile(join(tree, `../${label}.json`), JSON.stringify(record, null, 2), { flag: "wx" });
  console.log(JSON.stringify(record, null, 2));
  assert.ok(unchanged, "sealed inputs changed during execution");
  process.exitCode = result.status ?? 1;
} else throw new Error("Use seal; overlay BASELINE_TREE; refresh-baseline BASELINE_TREE; or run TREE old177|corrected177|targets12|types");
