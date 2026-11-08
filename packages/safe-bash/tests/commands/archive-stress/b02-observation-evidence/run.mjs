import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, lstat, readdir, mkdtemp, rm, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../../..");
const [argument, profile, output = "evidence.json"] = process.argv.slice(2);
assert.match(output, /^[a-z0-9-]+\.json$/u);
assert.equal(profile, "memory-intact-57a6148");
const frozen = await realpath(argument);
assert.notEqual(frozen, await realpath(repository));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const originalPath = "tests/commands/archive-stress/limits-effects.test.ts";
const priorReportPath = "tests/commands/archive-stress/pax-independent/runs/run-0N6uc7/evidence.json";
const rawFailurePath = "tests/commands/archive-stress/pax-independent/runs/run-0N6uc7/profile-refactored-stress30/stdout.log";
const authorManifestPath = "tests/commands/archive-stress/pax-extensibility-evidence/SHA256SUMS";
const priorBytes = await readFile(join(repository, priorReportPath));
assert.equal(hash(priorBytes), "6273a1e84302b08153b83131c0e7b24a66fb7d6f8adf7c64e61cdba4b787eb1b");
const prior = JSON.parse(priorBytes);
assert.equal(await realpath(prior.frozen), frozen);
const report = { profile, classification: "fixture-only transient overlay on unchanged retained verifier inputs; not current moving-source or full-gate validation", frozen, sourceHead: prior.sealedGit.head, priorSeal: prior.inputs.sha256, started: new Date().toISOString(), commands: [], node: process.version };
const groups = new Set();
const kill = pid => { try { process.kill(-pid, "SIGKILL"); return "owned group signalled"; } catch (error) { if (error.code !== "ESRCH") throw error; return "owned group absent"; } };
const environment = { ...process.env, TSX_DISABLE_CACHE: "1", NODE_PATH: "" };
for (const key of ["NODE_OPTIONS", "TSX_TSCONFIG_PATH", "TSX_PROJECT", "ESBUILD_BINARY_PATH", "ARCHIVE_ACCEPTANCE_SOURCE", ...Object.keys(environment).filter(key => key.startsWith("TS_NODE_"))]) delete environment[key];
const temporary = await mkdtemp("/tmp/safe-bash-b02-overlay-");
const overlay = join(frozen, "tests/commands/archive-stress", `.b02-observation-${temporary.split("-").at(-1)}.test.ts`);
const watchdog = setTimeout(() => { for (const pid of groups) kill(pid); }, 120000);

async function preserved() {
  const bytes = await readFile(join(repository, authorManifestPath));
  assert.equal(hash(bytes), "269d72a73614985f1f16257fa1951dd6eeb4d474230724be13db9c608780b06f");
  const entries = [...bytes.toString().matchAll(/^([a-f0-9]{64})  (.+)$/gm)];
  assert.equal(entries.length, 167);
  for (const entry of entries) assert.equal(hash(await readFile(join(repository, entry[2]))), entry[1], entry[2]);
  const raw = hash(await readFile(join(repository, rawFailurePath)));
  assert.equal(raw, "f3ea27f023c79ef47bd89e7973eaafafafea8af23f29123bae19e2d74478f465");
  return { authorManifest: hash(bytes), authorEntries: entries.length, rawFailure: raw };
}
async function frozenInputs() {
  const files = [];
  for (const entry of prior.inputs.files) {
    const full = join(frozen, entry.path);
    const stat = await lstat(full);
    assert(stat.isFile() && stat.nlink === 1, entry.path);
    const sha256 = hash(await readFile(full));
    assert.equal(sha256, entry.copiedSha256, entry.path);
    files.push({ path: entry.path, bytes: stat.size, sha256 });
  }
  return { count: files.length, sha256: hash(JSON.stringify(files)) };
}
async function run(label, args, timeout) {
  const command = { label, executable: process.execPath, args, cwd: frozen, timeout };
  const stdout = [], stderr = [];
  let count = 0;
  const child = spawn(process.execPath, args, { cwd: frozen, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  if (child.pid) groups.add(child.pid);
  const timer = setTimeout(() => { command.timedOut = true; if (child.pid) kill(child.pid); }, timeout);
  const collect = target => chunk => { count += chunk.length; if (count > 1024 * 1024) { command.outputLimit = true; if (child.pid) kill(child.pid); } else target.push(Buffer.from(chunk)); };
  child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
  child.once("exit", () => { if (child.pid) command.cleanup = kill(child.pid); });
  try {
    await new Promise((done, reject) => { child.once("error", reject); child.once("close", (status, signal) => { Object.assign(command, { status, signal }); done(); }); });
  } finally { clearTimeout(timer); if (child.pid) { kill(child.pid); groups.delete(child.pid); } }
  Object.assign(command, { stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), bytes: count });
  report.commands.push(command);
  console.log(JSON.stringify({ label, status: command.status }));
  assert.equal(command.timedOut, undefined);
  assert.equal(command.outputLimit, undefined);
  assert.equal(command.status, 0, command.stderr + command.stdout);
}

try {
  report.preservedBefore = await preserved();
  report.frozenBefore = await frozenInputs();
  const original = await readFile(join(frozen, originalPath));
  assert.equal(hash(original), "b7962d85dd8362b5da7f4df5839fb6e7b1f9cbd19295607252717a4e7018f2ae");
  const patched = await readFile(join(repository, originalPath));
  assert.equal(hash(patched), "7bedea0eddefcf40feb216fe41a600d2af429ff10813ed8a64df2e2d63329efe");
  const memoryHash = hash(await readFile(join(frozen, "src/fs/memory/index.ts")));
  assert.equal(memoryHash, "57a6148aec90c7a1db058e59bd2586e7c162c74498309e7173443096cb8906ad");
  await writeFile(overlay, patched, { flag: "wx", mode: 0o600 });
  assert.equal((await lstat(overlay)).nlink, 1);
  const control = await readFile(join(directory, "control.mjs"));
  await writeFile(join(temporary, "control.mjs"), control, { flag: "wx", mode: 0o600 });
  report.overlay = { path: overlay, original: originalPath, originalSha256: hash(original), patchedSha256: hash(patched), memoryHash, controlSha256: hash(control), regularFile: true, originalFrozenFileUnmodified: true };
  const loader = join(frozen, "node_modules/tsx/dist/loader.mjs");
  await run("no-tar-observation", ["--unhandled-rejections=strict", "--import", loader, join(temporary, "control.mjs"), frozen, profile], 10000);
  await run("B02-only", ["--unhandled-rejections=strict", "--import", loader, "--test", "--test-timeout=10000", "--test-name-pattern=^B02 ", overlay], 20000);
  const files = [];
  for (const folder of ["tests/commands/archive", "tests/commands/archive-stress"]) for (const name of await readdir(join(frozen, folder))) {
    const path = join(frozen, folder, name);
    if (name.endsWith(".ts") && !name.startsWith(".") && path !== join(frozen, originalPath)) files.push(path);
  }
  files.push(overlay);
  const config = { extends: join(frozen, "tsconfig.json"), compilerOptions: { noEmit: true, typeRoots: [join(frozen, "node_modules/@types")] }, files: files.sort(), include: [], exclude: [] };
  report.scopedTypes = config;
  await writeFile(join(temporary, "scope.json"), JSON.stringify(config), { flag: "wx", mode: 0o600 });
  await run("scoped-archive-types", [join(frozen, "node_modules/typescript/bin/tsc"), "-p", join(temporary, "scope.json")], 60000);
  assert.equal(hash(await readFile(join(repository, originalPath))), hash(patched));
  report.frozenAfter = await frozenInputs();
  assert.deepEqual(report.frozenAfter, report.frozenBefore);
  report.preservedAfter = await preserved();
  assert.deepEqual(report.preservedAfter, report.preservedBefore);
  report.pass = true;
} catch (error) { report.pass = false; report.error = { message: error.message, stack: error.stack }; }
finally {
  for (const pid of groups) kill(pid);
  await rm(overlay, { force: true });
  await rm(temporary, { recursive: true, force: true });
  report.cleanup = { removedOnlyOwnedOverlayAndTemporaryDirectory: true, originalSnapshotRetained: true };
  report.finished = new Date().toISOString();
  clearTimeout(watchdog);
  await writeFile(join(directory, output), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
}
assert.equal(report.pass, true, report.error?.message);
