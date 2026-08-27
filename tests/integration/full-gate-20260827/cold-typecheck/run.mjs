import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hash, inspect, repository } from "../inspect.mjs";
import { supervise } from "../supervise.mjs";

const revision = process.argv[2], output = process.argv[3];
assert.match(revision ?? "", /^[a-f0-9]{40}$/); assert.ok(output?.startsWith("/tmp/full-gate-cold-") && !existsSync(output)); mkdirSync(output);
assert.ok(process.argv[4] === undefined || process.argv[4] === "--e36-control");
const control = process.argv[4] === "--e36-control", sourceRevision = control ? "e36dab2b6abc216ddc89e5786a0eba76f08a1722" : revision;
const snapshot = inspect(sourceRevision), root = realpathSync(mkdtempSync("/tmp/full-gate-cold-execution-")), source = join(root, "source"), consumer = join(root, "consumer");
for (const directory of [source, consumer, join(root, "home"), join(root, "tmp")]) mkdirSync(directory);
const fixture = "tests/commands/table-text-stress/shared-stdin-review/selected-gnu.ts", configuration = "tests/commands/table-text-stress/shared-stdin-review/tsconfig.consumer.json";
const report = { revision, sourceRevision, control, harnessSha256: hash(readFileSync(fileURLToPath(import.meta.url))), startedAt: new Date().toISOString(), root, source, consumer, phases: [], scope: "Configuration-author validation only; different verifier required; no whole-suite rerun; e36 control is a separately labeled config-only overlay, never replacement historical evidence" };
const environment = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: join(root, "home"), TMPDIR: join(root, "tmp"), LANG: "C", LC_ALL: "C", TZ: "UTC", TSX_DISABLE_CACHE: "1",
  npm_config_offline: "true", npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_registry: "http://127.0.0.1:1", npm_config_cache: join(root, "cache"), npm_config_userconfig: join(root, "npmrc"), npm_config_globalconfig: join(root, "global-npmrc") };
writeFileSync(environment.npm_config_userconfig, ""); writeFileSync(environment.npm_config_globalconfig, "");
const save = () => writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
const sourceHashes = {}, dependencyHashes = {};
function checkInputs() {
  for (const [path, expected] of Object.entries(sourceHashes)) assert.equal(hash(readFileSync(join(source, path))), expected, path);
  for (const [path, expected] of Object.entries(dependencyHashes)) assert.equal(hash(readFileSync(join(source, "node_modules", path))), expected, path);
}
async function phase(label, command, args, cwd = source, expected = 0) {
  const result = await supervise(command, args, { cwd, env: environment, timeoutMs: 180000, stdout: join(output, label + ".stdout.log"), stderr: join(output, label + ".stderr.log") });
  Object.assign(result, { label, expected, stdout: readFileSync(join(output, label + ".stdout.log"), "utf8"), stderr: readFileSync(join(output, label + ".stderr.log"), "utf8") });
  report.phases.push(result); save(); assert.equal(result.clean, true, label); assert.equal(result.status, expected, label + "\n" + result.stdout + result.stderr); return result;
}
const codes = text => [...text.matchAll(/error TS(\d+):/g)].map(match => Number(match[1])).sort((left, right) => left - right);
try {
  const archive = join(root, "source.tar"); execFileSync("git", ["archive", "-o", archive, sourceRevision], { cwd: repository, timeout: 180000 });
  report.archiveSha256 = hash(readFileSync(archive)); execFileSync("tar", ["-xf", archive, "-C", source], { timeout: 180000 });
  for (const row of snapshot.tree) { const path = join(source, row.path), info = lstatSync(path); assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1); sourceHashes[row.path] = hash(readFileSync(path)); }
  report.sourceManifestSha256 = hash(JSON.stringify(sourceHashes)); report.canonicalTestFiles = snapshot.canonicalTestFiles.map(row => row.path);
  const committed = path => execFileSync("git", ["show", `${revision}:${path}`], { cwd: repository });
  const oldConfiguration = execFileSync("git", ["show", `${control ? sourceRevision : revision + "^"}:tsconfig.json`], { cwd: repository });
  if (control) {
    writeFileSync(join(source, "tsconfig.json"), committed("tsconfig.json")); writeFileSync(join(source, configuration), committed(configuration));
    const manifest = JSON.parse(readFileSync(join(source, "package.json"))); manifest.scripts["typecheck:consumers"] = JSON.parse(committed("package.json")).scripts["typecheck:consumers"];
    writeFileSync(join(source, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
    report.configurationOnlyOverlay = ["package.json", "tsconfig.json", configuration];
    for (const path of report.configurationOnlyOverlay) sourceHashes[path] = hash(readFileSync(join(source, path)));
    report.overlaySha256 = Object.fromEntries(report.configurationOnlyOverlay.map(path => [path, sourceHashes[path]]));
  }
  const newConfiguration = readFileSync(join(source, "tsconfig.json"));
  report.configuration = { original: JSON.parse(oldConfiguration), fixed: JSON.parse(newConfiguration), consumer: JSON.parse(readFileSync(join(source, configuration))), script: JSON.parse(readFileSync(join(source, "package.json"))).scripts["typecheck:consumers"] };
  report.originalFixtureSha256 = sourceHashes[fixture];
  assert.equal(hash(execFileSync("git", ["show", `e36dab2:${fixture}`], { cwd: repository })), report.originalFixtureSha256);
  const origin = join(repository, "node_modules"), destination = join(source, "node_modules");
  const copy = directory => { for (const name of readdirSync(directory).sort()) {
    if (name === ".bin") continue;
    const path = join(directory, name), info = lstatSync(path), local = relative(origin, path); assert.equal(info.isSymbolicLink(), false);
    if (info.isDirectory()) copy(path); else { assert.ok(info.isFile()); const bytes = readFileSync(path), target = join(destination, local); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); chmodSync(target, info.mode & 0o777); dependencyHashes[local] = hash(bytes); }
  } }; copy(origin);
  mkdirSync(join(destination, ".bin"));
  for (const name of readdirSync(join(origin, ".bin"))) {
    const original = realpathSync(join(origin, ".bin", name)); assert.ok(original.startsWith(origin + "/"));
    const target = join(destination, relative(origin, original)), bin = join(destination, ".bin", name);
    writeFileSync(bin, `#!/bin/sh\nexec '${target.replaceAll("'", "'\\''")}' "$@"\n`); chmodSync(bin, 0o755); dependencyHashes[".bin/" + name] = hash(readFileSync(bin));
  }
  report.dependenciesSha256 = hash(JSON.stringify(dependencyHashes));
  assert.equal(existsSync(join(source, "dist")), false);
  writeFileSync(join(source, "tsconfig.json"), oldConfiguration);
  try { const before = await phase("original-cold", "npm", ["run", "typecheck"], source, 2);
    const lines = before.stdout.split("\n").filter(line => /error TS\d+:/.test(line));
    report.preservedOtherDiagnostics = lines.filter(line => !line.startsWith(fixture));
    assert.deepEqual(codes(lines.filter(line => line.startsWith(fixture)).join("\n")), [2307, 2307, 7006, 7006, 7006, 7006]);
    if (control) assert.deepEqual(report.preservedOtherDiagnostics, []);
    else { assert.equal(report.preservedOtherDiagnostics.length, 1); assert.match(report.preservedOtherDiagnostics[0], /^tests\/commands\/stream-next-stress\/independent\.test\.ts\(91,95\): error TS7053:/); }
  }
  finally { writeFileSync(join(source, "tsconfig.json"), newConfiguration); }
  const fixed = await phase("fixed-cold", "npm", ["run", "typecheck"], source, control ? 0 : 2);
  assert.deepEqual(fixed.stdout.split("\n").filter(line => /error TS\d+:/.test(line)), report.preservedOtherDiagnostics); assert.equal(existsSync(join(source, "dist")), false);
  const compiler = join(source, "node_modules/typescript/bin/tsc");
  const discovery = await phase("cold-discovery", process.execPath, [compiler, "--noEmit", "--listFilesOnly"]);
  const listed = new Set(discovery.stdout.trim().split("\n").map(path => relative(source, path.trim())));
  assert.equal(listed.has(fixture), false); assert.ok(report.canonicalTestFiles.every(path => listed.has(path)));
  report.discovery = { canonicalIncluded: report.canonicalTestFiles.length, excludedHistoricalFixture: fixture, sourceFilesIncluded: Object.keys(sourceHashes).filter(path => path.startsWith("src/") && path.endsWith(".ts")).every(path => listed.has(path)) }; assert.equal(report.discovery.sourceFilesIncluded, true);
  const coldProbe = join(source, "tests/full-gate-cold-probe.test.ts"); assert.equal(existsSync(coldProbe), false);
  writeFileSync(coldProbe, 'const coldSourceProbe: number = "bad"; export {};\n');
  try { const negative = await phase("cold-test-negative", "npm", ["run", "typecheck"], source, 2); assert.deepEqual(codes(negative.stdout), control ? [2322] : [2322, 7053]); assert.match(negative.stdout, /full-gate-cold-probe\.test\.ts/); }
  finally { rmSync(coldProbe); }
  const beforeBuild = await phase("consumer-before-build-negative", process.execPath, [compiler, "--noEmit", "-p", configuration], source, 2);
  assert.deepEqual(codes(beforeBuild.stdout), [2307, 2307, 7006, 7006, 7006, 7006]);
  await phase("built-consumer-command", "npm", ["run", "typecheck:consumers"]); assert.equal(existsSync(join(source, "dist/index.d.ts")), true);
  const consumerList = await phase("built-consumer-discovery", process.execPath, [compiler, "--noEmit", "-p", configuration, "--listFilesOnly"]);
  assert.ok(consumerList.stdout.split("\n").includes(join(source, fixture)));
  const originalFixture = readFileSync(join(source, fixture));
  writeFileSync(join(source, fixture), Buffer.concat([originalFixture, Buffer.from('\nconst coldConsumerProbe: number = "bad";\n')]));
  try { const negative = await phase("historical-consumer-negative", process.execPath, [compiler, "--noEmit", "-p", configuration], source, 2); assert.deepEqual(codes(negative.stdout), [2322]); assert.ok(negative.stdout.includes(fixture)); }
  finally { writeFileSync(join(source, fixture), originalFixture); }
  checkInputs();
  const packed = await phase("pack", "npm", ["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", root]);
  const tarball = join(root, JSON.parse(packed.stdout)[0].filename); report.packageSha256 = hash(readFileSync(tarball));
  writeFileSync(join(consumer, "package.json"), '{"private":true,"type":"module"}\n');
  await phase("install", "npm", ["install", "--offline", "--ignore-scripts", "--omit=dev", "--no-package-lock", tarball], consumer);
  assert.equal(existsSync(join(consumer, "node_modules/virtual-bash/src")), false);
  const materials = [["tests/integration/full-gate-20260827/public.mjs", "public.mjs"], ["tests/integration/full-gate-20260827/consumer.mts.fixture", "aggregate.mts"],
    ["tests/integration/s3-http-exports/fixtures/consumer.ts.fixture", "consumer.mts"], ["tests/integration/s3-http-exports/fixtures/invalid.ts.fixture", "invalid.mts"], ["tests/integration/s3-http-exports/fixtures/runtime.mjs", "runtime.mjs"]];
  report.fixtureHashes = {}; report.validationFixtureRevision = revision;
  for (const [from, to] of materials) { const bytes = committed(from); report.fixtureHashes[from] = hash(bytes); writeFileSync(join(consumer, to), bytes); }
  const publicResult = await phase("packed-public", process.execPath, ["public.mjs"], consumer); report.public = JSON.parse(publicResult.stdout);
  await phase("packed-import-guard", process.execPath, ["runtime.mjs", join(source, "src/fs/s3/http/index.ts")], consumer);
  const options = [compiler, "--noEmit", "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "false", "--types", "node", "--typeRoots", join(source, "node_modules/@types")];
  const positive = await phase("packed-types-positive", process.execPath, [...options, "--listFiles", "aggregate.mts", "consumer.mts"], consumer);
  const typePaths = positive.stdout.trim().split("\n").map(path => realpathSync(resolve(consumer, path))); assert.ok(typePaths.includes(join(consumer, "node_modules/virtual-bash/dist/index.d.ts")));
  assert.ok(typePaths.every(path => path.startsWith(consumer + "/") || path.startsWith(join(source, "node_modules") + "/")), "No product-source fallback in public types"); report.publicTypePaths = typePaths;
  const negative = await phase("packed-types-negative", process.execPath, [...options, "invalid.mts"], consumer, 2); assert.deepEqual(codes(negative.stdout), [2322, 2345, 2741]); report.publicNegativeCodes = codes(negative.stdout);
  checkInputs(); report.inputsUnchanged = true; report.status = "captured";
} catch (error) { report.status = "failed"; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  rmSync(root, { recursive: true, force: true }); report.temporaryRemoved = !existsSync(root); report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, error: report.error, revision, discovery: report.discovery, phases: report.phases.map(({label,status,expected,clean})=>({label,status,expected,clean})), temporaryRemoved: report.temporaryRemoved }, null, 2));
}
