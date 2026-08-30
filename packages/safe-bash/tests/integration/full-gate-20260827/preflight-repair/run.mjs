import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect, git, hash, repository } from "../combined-b494675c/inspect.mjs";
import { account } from "../account.mjs";
import { supervise } from "../supervise.mjs";
import { isolatedHistory } from "../history.mjs";

import { assessRepository, requireAdmission, stageNative, verifyNativeStaging } from "./preflight.mjs";

import { prerequisites, privateState } from "../combined-b494675c/prerequisites.mjs";

const harness = fileURLToPath(new URL("../combined-b494675c/", import.meta.url));
const launchPreflight = assessRepository({ repository, candidate: process.argv[3] });
console.log(JSON.stringify({ preflight: launchPreflight }));
requireAdmission(launchPreflight);
assert.equal(process.argv[2], "--handoff", "Full execution requires explicit --handoff COMMIT --execute NEW_OUTPUT");
assert.match(process.argv[3] ?? "", /^[a-f0-9]{40}$/, "Use the exact integration commit relayed by root, not HEAD or an inferred latest commit");
assert.equal(process.argv[4], "--execute"); assert.ok(process.argv[5]);
assert.equal(process.argv[3], "b494675c34dc289f4ad4b10a9201e1211eb0a7d8");
const discovery = inspect(process.argv[3]), output = resolve(process.argv[5]);
assert.ok(output.startsWith("/tmp/full-gate-") && !existsSync(output), "Use a new task-owned /tmp/full-gate-* capture directory");
mkdirSync(output);
const temporary = realpathSync(mkdtempSync("/tmp/full-gate-execution-")), source = join(temporary, "source"), consumer = join(temporary, "consumer");
for (const directory of [source, consumer, join(temporary, "home"), join(temporary, "tmp"), join(temporary, "harness"), join(temporary, "native-bin")]) mkdirSync(directory);
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const npmPath = realpathSync(execFileSync("/bin/sh", ["-c", "command -v npm"], { encoding: "utf8" }).trim());
const npmRoot = resolve(dirname(npmPath), "..");
const environment = { PATH: `${join(temporary, "native-bin")}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: join(temporary, "home"),
  TMPDIR: join(temporary, "tmp"), TMP: join(temporary, "tmp"), TEMP: join(temporary, "tmp"), XDG_CACHE_HOME: join(temporary, "tmp"),
  LANG: "C", LC_ALL: "C", TZ: "UTC", GIT_OPTIONAL_LOCKS: "0", TSX_DISABLE_CACHE: "1", RIPGREP_CONFIG_PATH: "", NO_COLOR: "1",
  npm_config_cache: join(temporary, "npm-cache"), npm_config_userconfig: join(temporary, "npmrc"), npm_config_globalconfig: join(temporary, "global-npmrc"),
  npm_config_registry: "http://127.0.0.1:1", npm_config_offline: "true", npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false",
  FULL_GATE_ROOT: temporary, FULL_GATE_TOOL_ROOTS: JSON.stringify([npmRoot]) };
writeFileSync(environment.npm_config_userconfig, ""); writeFileSync(environment.npm_config_globalconfig, "");
const report = { startedAt: new Date().toISOString(), revision: discovery.revision, discovery, temporary, source, consumer, environment, phases: [],
  node: { version: process.version, executable: process.execPath, sha256: hash(readFileSync(process.execPath)), platform: process.platform, arch: process.arch },
  npm: { executable: npmPath, sha256: hash(readFileSync(npmPath)), version: execFileSync(process.execPath, [npmPath, "--version"], { encoding: "utf8", env: environment, timeout: 10000 }).trim() }, handoffRequiredDefaultCount: 70, noPrivateEngine: false,
  fullCompatibilityClaim: false, actualSafeJsAcceptance: "current copied engine availability must be proved; actual outcomes and characterizations counted without upstream acceptance inference" };
const sourceHashes = {};
function verifySource() {
  const changes = [];
  for (const [path, expected] of Object.entries(sourceHashes)) {
    const filename = join(source, path), stat = lstatSync(filename, { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() !== expected.symlink ||
      hash(expected.symlink ? Buffer.from(readlinkSync(filename)) : readFileSync(filename)) !== expected.sha256 ||
      (stat.mode & 0o777) !== expected.mode) changes.push(path);
  }
  return changes;
}
function copyDependencies(origin, destination) {
  const files = {}, skippedBins = [];
  const visit = directory => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), local = relative(origin, path), info = lstatSync(path);
      if (name === ".bin") { skippedBins.push(local); continue; }
      assert.equal(info.isSymbolicLink(), false, `Dependency source link needs explicit review: ${path}`);
      if (info.isDirectory()) visit(path);
      else {
        assert.ok(info.isFile()); const bytes = readFileSync(path), target = join(destination, local);
        mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); chmodSync(target, info.mode & 0o777);
        assert.notEqual(lstatSync(target).ino, info.ino); assert.equal(lstatSync(target).nlink, 1);
        files[local] = { sha256: hash(bytes), bytes: bytes.length, mode: info.mode & 0o777 };
      }
    }
  };
  visit(origin);
  const bins = {};
  for (const directory of skippedBins) for (const name of readdirSync(join(origin, directory))) {
    const local = join(directory, name), original = join(origin, local), bin = join(destination, local), info = lstatSync(original);
    mkdirSync(dirname(bin), { recursive: true });
    if (info.isSymbolicLink()) {
      const target = realpathSync(original); assert.ok(target.startsWith(origin + "/"), `External binary link: ${original}`);
      const targetRelative = relative(origin, target), installed = join(destination, targetRelative); assert.ok(existsSync(installed));
      writeFileSync(bin, "#!/bin/sh\nexec " + quote(installed) + ' "$@"\n'); chmodSync(bin, 0o755);
      bins[local] = { sourceKind: "link", targetRelative, sha256: hash(readFileSync(bin)), mode: 0o755 };
    } else {
      assert.ok(info.isFile()); copyFileSync(original, bin); chmodSync(bin, info.mode & 0o777);
      bins[local] = { sourceKind: "regular", sha256: hash(readFileSync(bin)), mode: info.mode & 0o777 };
    }
  }
  return { origin, destination, files, bins, binPolicy: "Regular wrappers preserve the exact installed .bin link target; no symlink is reused and no manifest-based bin selection is invented" };
}
async function phase(label, executable, args, cwd = source, timeoutMs = 180000) {
  const env = { ...environment, FULL_GATE_IMPORTS: join(output, "imports", label), NODE_OPTIONS: "--import=" + pathToFileURL(join(temporary, "harness/import-guard.mjs")).href };
  const result = await supervise(executable, args, { cwd, env, timeoutMs, stdout: join(output, label + ".stdout.log"), stderr: join(output, label + ".stderr.log"), observeSockets: true });
  result.label = label; result.sourceChanges = verifySource(); report.phases.push(result); save(label + ".result.json", result);
  if (label === "test" || label === "contracts") { result.accounting = account(readFileSync(join(output, label + ".stdout.log"), "utf8")); save(label + ".accounting.json", result.accounting); }
  save("report.json", report);
  assert.deepEqual(result.sourceChanges, [], `Frozen tracked inputs changed during ${label}; later gates must not use mutated inputs`);
  return result;
}
try {
  const expected = { test: "node --input-type=module -e \"import { globSync } from 'node:fs'; import { spawnSync } from 'node:child_process'; const files = globSync('tests/**/*.test.ts', { exclude: path => path === 'tests/commands/regex-execution/continuation/artifacts/native' }); if (!files.length) throw new Error('No test files found'); const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files, ...process.argv.slice(1)], { stdio: 'inherit' }); process.exit(result.status ?? 1);\" --", "test:contracts": 'node --import tsx --test "tests/contracts/**/*.test.ts"', typecheck: "tsc --noEmit", build: "tsc -p tsconfig.build.json" };
  for (const [name, value] of Object.entries(expected)) assert.equal(discovery.configuration["package.json"].value.scripts[name], value, `Declared command changed: ${name}`);
  assert.equal(discovery.configuration["benchmarks/package.json"].value.scripts.typecheck, "tsc --noEmit -p tsconfig.json");
  assert.deepEqual(discovery.configuration["package.json"].value.dependencies ?? {}, {});
  report.liveBefore = { head: git("rev-parse", "HEAD").trim(), status: git("status", "--porcelain=v1") };
  const archive = join(temporary, "source.tar"); execFileSync("git", ["archive", "-o", archive, discovery.revision], { cwd: repository, timeout: 180000 });
  const archiveHash = createHash("sha256"); for await (const chunk of createReadStream(archive)) archiveHash.update(chunk);
  report.archiveSha256 = archiveHash.digest("hex"); execFileSync("tar", ["-xf", archive, "-C", source], { timeout: 180000 });
  for (const entry of discovery.tree) {
    const path = join(source, entry.path), stat = lstatSync(path), symlink = entry.mode === "120000";
    assert.equal(stat.isSymbolicLink(), symlink);
    assert.ok(symlink || (stat.isFile() && stat.nlink === 1));
    const bytes = symlink ? Buffer.from(readlinkSync(path)) : readFileSync(path); assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), entry.blob, entry.path);
    sourceHashes[entry.path] = { sha256: hash(bytes), mode: stat.mode & 0o777, bytes: bytes.length, symlink };
  }
  report.sourceHashes = sourceHashes;
  report.history = await isolatedHistory(repository, source, discovery.revision, join(temporary, "history.pack"), environment);
  report.dependencies = { root: copyDependencies(join(repository, "node_modules"), join(source, "node_modules")), benchmarks: copyDependencies(join(repository, "benchmarks/node_modules"), join(source, "benchmarks/node_modules")) };
  for (const [key, folder] of [["root", source], ["benchmarks", join(source, "benchmarks")]]) {
    const lock = JSON.parse(readFileSync(join(folder, "package-lock.json"), "utf8"));
    const discrepancies = [], missingOptional = [], installed = [];
    for (const [name, metadata] of Object.entries(lock.packages ?? {}).filter(([name]) => name)) {
      const path = join(folder, name, "package.json");
      if (!existsSync(path)) { if (!metadata.optional) discrepancies.push({ name, reason: "missing nonoptional dependency" }); else missingOptional.push({ name, version: metadata.version, os: metadata.os, cpu: metadata.cpu }); continue; }
      const actual = JSON.parse(readFileSync(path, "utf8")); installed.push({ name, version: actual.version, manifestSha256: hash(readFileSync(path)) });
      if (metadata.version !== actual.version) discrepancies.push({ name, expected: metadata.version, actual: actual.version });
    }
    Object.assign(report.dependencies[key], { lockDiscrepancies: discrepancies, missingOptional, installed }); assert.deepEqual(discrepancies, []);
  }
  assert.equal(JSON.parse(readFileSync(join(source, "benchmarks/node_modules/just-bash/package.json"), "utf8")).version, "3.4.2");
  report.harnessHashes = Object.fromEntries(readdirSync(harness).filter(name => /\.(mjs|fixture)$/.test(name)).map(name => [name, hash(readFileSync(join(harness, name)))]));
  for (const name of ["import-guard.mjs", "public.mjs", "consumer.mts.fixture"]) { const bytes = readFileSync(join(harness, name)); writeFileSync(join(temporary, "harness", name), bytes); report.harnessHashes[name] = hash(bytes); }
  report.launchPreflight = launchPreflight;
  report.prerequisites = await prerequisites({ repository, source, temporary, environment, candidate: discovery.revision });
  report.mandatoryNativeStaging = stageNative(launchPreflight, { snapshot: source, nativeRoot: join(temporary, "native-bin"), environment });
  save("prerequisites.json", report.prerequisites);
  report.native = {};
  const native = [["bash3.2", "/bin/bash"], ["bash5.3", "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash"], ["sed", "/usr/bin/sed"], ["awk", "/usr/bin/awk"], ["jq", "/usr/bin/jq"], ["gzip", "/usr/bin/gzip"], ["curl", "/usr/bin/curl"]];
  let rgPath; try { rgPath = execFileSync("/bin/sh", ["-c", "command -v rg"], { encoding: "utf8" }).trim(); } catch {}
  if (rgPath) { native.push(["rg", rgPath]); copyFileSync(realpathSync(rgPath), join(temporary, "native-bin/rg")); chmodSync(join(temporary, "native-bin/rg"), 0o755); }
  for (const [name, path] of native) {
    if (!existsSync(path)) { report.native[name] = { path, available: false }; continue; }
    const version = spawnSync(path, ["--version"], { encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024, env: environment });
    report.native[name] = { path, resolved: realpathSync(path), sha256: hash(readFileSync(path)), available: true, version: { status: version.status, stdout: version.stdout, stderr: version.stderr, error: version.error?.message } };
  }
  assert.equal(process.platform, "darwin", "This prepared native profile is Darwin, not a claimed Linux gate");
  assert.match(report.native["bash3.2"].version.stdout, /version 3\.2\./);
  if (report.native["bash5.3"].available) assert.equal(report.native["bash5.3"].sha256, "8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c");
  report.locales = execFileSync("/usr/bin/locale", ["-a"], { encoding: "utf8", env: environment });
  report.oracleProfile = "Darwin, sanitized LC_ALL/LANG=C and TZ=UTC; fixtures retain explicit UTF8 overrides. /bin/bash remains Apple Bash3.2, separately pinned GNU5.3 is not substituted. Explicit pinned GNU byte oracle variables and regular-copy SAFEJS_LOCAL_ROOT are set; no default /bin/bash replacement.";
  const discovered = await phase("canonical-discovery", process.execPath, ["--input-type=module", "-e", "import{globSync}from'node:fs';const files=globSync('tests/**/*.test.ts',{exclude:path=>path==='tests/commands/regex-execution/continuation/artifacts/native'});console.log(JSON.stringify(files.sort()));"]);
  assert.equal(discovered.status, 0);
  report.actualCanonicalFiles = JSON.parse(readFileSync(join(output, "canonical-discovery.stdout.log"), "utf8"));
  const expectedCanonical = discovery.canonicalTestFiles.map(entry => entry.path).filter(path => !path.startsWith("tests/commands/regex-execution/continuation/artifacts/native/")).sort();
  assert.deepEqual(report.actualCanonicalFiles, expectedCanonical);
  discovery.safejs = report.prerequisites.safejs.policy;
  discovery.exclusions = "Exact committed npm glob: tests/**/*.test.ts, excluding only tests/commands/regex-execution/continuation/artifacts/native as declared. No additional failed/historical tests removed. Explicit current .mts programs are a separate repaired consumer phase.";
  await phase("safejs-availability", process.execPath, ["--import", "tsx", "--input-type=module", "-e", "import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import{join}from'node:path';const module=await import(pathToFileURL(join(process.env.SAFEJS_LOCAL_ROOT,'src/run.ts')).href);assert.equal(typeof module.run,'function');const result=await module.run('1+2');assert.equal(result.ok,true);console.log(JSON.stringify({actualCopiedEngine:true,result}));"]);
  await phase("typecheck", "npm", ["run", "typecheck"]);
  const build = await phase("build", "npm", ["run", "build"]);
  requireAdmission(assessRepository({ repository, candidate: discovery.revision }));
  assert.deepEqual(verifySource(), [], "Tracked snapshot changed before canonical suite");
  verifyNativeStaging(report.mandatoryNativeStaging);
  await phase("test", "npm", ["test"], source, 900000);
  await phase("explicit-current-consumers", process.execPath, ["scripts/verify-current-consumers.mjs", "--source-commit", discovery.revision], source, 180000);
  await phase("contracts", "npm", ["run", "test:contracts"]);
  await phase("benchmark-types", "npm", ["--prefix", "benchmarks", "run", "typecheck"]);
  if (build.status === 0 && build.clean) {
    const packed = await phase("pack", "npm", ["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", temporary]);
    if (packed.status === 0 && packed.clean) {
      const artifact = JSON.parse(readFileSync(join(output, "pack.stdout.log"), "utf8"))[0]; report.packageSha256 = hash(readFileSync(join(temporary, artifact.filename)));
      writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
      const installed = await phase("install", "npm", ["install", "--offline", "--ignore-scripts", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund", join(temporary, artifact.filename)], consumer);
      if (installed.status === 0 && installed.clean) {
        assert.equal(existsSync(join(consumer, "node_modules/virtual-bash/src")), false);
        copyFileSync(join(harness, "public.mjs"), join(consumer, "public.mjs")); copyFileSync(join(harness, "consumer.mts.fixture"), join(consumer, "consumer.mts"));
        const publicResult = await phase("public", process.execPath, ["public.mjs"], consumer);
        if (publicResult.status === 0) report.public = JSON.parse(readFileSync(join(output, "public.stdout.log"), "utf8"));
        await phase("public-types", process.execPath, [join(source, "node_modules/typescript/bin/tsc"), "--noEmit", "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--skipLibCheck", "false", "--types", "node", "--typeRoots", join(source, "node_modules/@types"), "consumer.mts"], consumer);
      }
    }
  } else report.publicBlocked = "Production build failed; no stale dist or source fallback used";
  report.privateAfter = privateState(); report.privateUnchanged = JSON.stringify(report.privateAfter) === JSON.stringify(report.prerequisites.safejs.before);
  report.sourceChanges = verifySource(); report.liveAfter = { head: git("rev-parse", "HEAD").trim(), status: git("status", "--porcelain=v1") };
  report.dependencyChanges = [];
  for (const [kind, dependency] of Object.entries(report.dependencies)) for (const [path, expected] of Object.entries({ ...dependency.files, ...dependency.bins })) {
    const filename = join(dependency.destination, path);
    if (!existsSync(filename) || hash(readFileSync(filename)) !== expected.sha256 || (lstatSync(filename).mode & 0o777) !== expected.mode) report.dependencyChanges.push({ kind, path });
  }
  report.status = "captured";
  report.declaredGateCommandsSucceeded = report.privateUnchanged && report.dependencyChanges.length === 0 && report.phases.every(phase => phase.status === 0 && phase.clean && phase.sourceChanges.length === 0 && (!phase.accounting || phase.accounting.reconciled)) && report.public?.count === 70;
  report.testOutcomeCounts = report.phases.find(phase => phase.label === "test")?.accounting?.counts;
  if (!report.declaredGateCommandsSucceeded) process.exitCode = 1;
} catch (error) { report.status = "infrastructure-failed"; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  rmSync(temporary, { recursive: true, force: true }); report.temporaryRemoved = !existsSync(temporary); report.finishedAt = new Date().toISOString(); save("report.json", report);
  console.log(JSON.stringify({ output, revision: report.revision, status: report.status, declaredGateCommandsSucceeded: report.declaredGateCommandsSucceeded, testOutcomeCounts: report.testOutcomeCounts, error: report.error, phases: report.phases.map(({ label, status, clean }) => ({ label, status, clean })), temporaryRemoved: report.temporaryRemoved }, null, 2));
}
