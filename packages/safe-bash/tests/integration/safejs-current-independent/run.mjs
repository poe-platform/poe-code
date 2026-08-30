import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const harness = dirname(fileURLToPath(import.meta.url));
const repository = resolve(harness, "../../..");
assert.ok(process.argv[2] && process.argv[3] && process.argv[4], "run.mjs PRIVATE_ROOT NEW_OUTPUT REVISION [full]");
const privateRoot = realpathSync(process.argv[2]), output = resolve(process.argv[3]);
assert.ok(output !== privateRoot && !output.startsWith(privateRoot + "/") && !existsSync(output));
mkdirSync(output, { recursive: true });
const temporary = realpathSync(mkdtempSync("/tmp/safejs-independent-"));
const product = join(temporary, "product"), consumer = join(temporary, "consumer"), tools = join(temporary, "node_modules");
for (const directory of [product, consumer, tools, join(temporary, "home"), join(temporary, "tmp")]) mkdirSync(directory, { recursive: true });
const environment = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(temporary, "home"), TMPDIR: join(temporary, "tmp"),
  TMP: join(temporary, "tmp"), TEMP: join(temporary, "tmp"), XDG_CACHE_HOME: join(temporary, "tmp"), LC_ALL: "C", TZ: "UTC", GIT_OPTIONAL_LOCKS: "0", TSX_DISABLE_CACHE: "1",
  npm_config_cache: join(temporary, "cache"), npm_config_userconfig: join(temporary, "npmrc"), npm_config_globalconfig: join(temporary, "global-npmrc"),
  npm_config_registry: "http://127.0.0.1:1", npm_config_offline: "true", npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false" };
writeFileSync(environment.npm_config_userconfig, ""); writeFileSync(environment.npm_config_globalconfig, "");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: environment });
const revision = git(repository, "rev-parse", process.argv[4]).trim();
const authorRevision = "3a2d9ca";
const excluded = new Set([".git", "node_modules", "dist", ".cache", ".turbo"]);
function inventory(root, ignore = excluded) {
  const files = {};
  const visit = directory => {
    for (const name of readdirSync(directory).sort()) {
      if (ignore.has(name)) continue;
      const filename = join(directory, name), stat = lstatSync(filename);
      assert.equal(stat.isSymbolicLink(), false, filename);
      if (stat.isDirectory()) visit(filename);
      else { assert.ok(stat.isFile(), filename); files[relative(root, filename)] = { sha256: hash(readFileSync(filename)), mode: stat.mode & 0o777 }; }
    }
  };
  visit(root); return files;
}
function copy(source, destination, ignore = excluded) {
  const files = inventory(source, ignore);
  for (const [name, info] of Object.entries(files)) {
    const bytes = readFileSync(join(source, name)); assert.equal(hash(bytes), info.sha256);
    mkdirSync(dirname(join(destination, name)), { recursive: true }); writeFileSync(join(destination, name), bytes); chmodSync(join(destination, name), info.mode);
  }
  assert.deepEqual(inventory(destination, ignore), files); return files;
}
function privateState() {
  const metadata = {};
  for (const path of ["AGENTS.md", "package.json", "package-lock.json", "tsconfig.json", "LICENSE", "packages/poe-agent/package.json"]) metadata[path] = hash(readFileSync(join(privateRoot, path)));
  return { head: git(privateRoot, "rev-parse", "HEAD").trim(), status: git(privateRoot, "status", "--porcelain=v1"),
    index: hash(readFileSync(resolve(privateRoot, git(privateRoot, "rev-parse", "--git-path", "index").trim()))), metadata,
    engine: inventory(join(privateRoot, "packages/safejs")) };
}
const report = { revision, authorRevision, privateRoot, startedAt: new Date().toISOString(), temporary, node: process.version, nodeSha256: hash(readFileSync(process.execPath)), platform: process.platform, arch: process.arch,
  commands: [], cohorts: {}, tools: {}, proposalApplied: false, engineBuiltInPrivate: false };
const save = (name, value) => writeFileSync(join(output, name), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
function tool(name, root, optional = false) {
  if (existsSync(join(tools, name))) return;
  let location = root, found;
  while (true) {
    const candidate = join(location, "node_modules", name);
    if (existsSync(candidate)) { found = realpathSync(candidate); break; }
    const parent = dirname(location); if (parent === location) break; location = parent;
  }
  if (!found && optional) return;
  assert.ok(found, `Missing cached tool ${name}`); assert.ok(!found.includes("/packages/"));
  const manifest = JSON.parse(readFileSync(join(found, "package.json"), "utf8"));
  const copied = copy(found, join(tools, name), new Set(["node_modules", ".git", ".cache"]));
  report.tools[name] = { source: found, version: manifest.version, treeSha256: hash(JSON.stringify(copied)), files: Object.keys(copied).length };
  for (const dependency of Object.keys(manifest.dependencies ?? {})) tool(dependency, found);
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) tool(dependency, found, true);
}
function run(label, executable, args, cwd = consumer, env = environment, timeout = 180000) {
  const result = spawnSync(executable, args, { cwd, env, timeout, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const command = { label, executable, args, cwd, status: result.status, signal: result.signal, error: result.error?.message };
  report.commands.push(command); save(label + ".stdout.log", result.stdout ?? ""); save(label + ".stderr.log", result.stderr ?? "");
  assert.equal(result.error, undefined, `${label}: ${result.error}`);
  return { ...command, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
function success(result) { assert.equal(result.status, 0, `${result.label}: ${result.stdout}\n${result.stderr}`); return result; }
const copiedEngine = join(consumer, "packages/safejs");
function cohort(label, files, options = {}) {
  const env = { ...environment, SAFEJS_REVIEW_ROOT: temporary, SAFEJS_REVIEW_PROOF: join(output, label + ".imports.ndjson"), SAFEJS_FORBIDDEN_ROOT: privateRoot,
    NODE_OPTIONS: "--import=" + pathToFileURL(join(consumer, "load-proof.mjs")).href, ...(options.disabled ? {} : { SAFEJS_LOCAL_ROOT: copiedEngine }) };
  const result = run(label, process.execPath, ["--unhandled-rejections=strict", "--max-old-space-size=768", "--import", "tsx", "--test", "--test-concurrency=1", "--test-timeout=20000", "--test-reporter=" + join(consumer, "reporter.mjs"), ...(options.pattern ? ["--test-name-pattern", options.pattern] : []), ...files], consumer, env);
  const events = result.stdout.split("\n").filter(Boolean).map(line => JSON.parse(line));
  const cases = events.filter(event => ["test:pass", "test:fail"].includes(event.type) && event.data.nesting === 0).map(event => ({ ...event.data, outcome: event.data.skip ? "skip" : event.type === "test:pass" ? "pass" : "fail" }));
  const counts = { pass: 0, fail: 0, skip: 0 }; for (const entry of cases) counts[entry.outcome]++;
  assert.ok(cases.length); if (!options.disabled) assert.equal(counts.skip, 0, label);
  const loads = readFileSync(env.SAFEJS_REVIEW_PROOF, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const engineFiles = Object.fromEntries(loads.filter(row => row.kind === "actual-engine-copy").map(row => [row.loaded, row.sha256]));
  for (const [filename, digest] of Object.entries(engineFiles)) assert.equal(digest, report.engineCopy[filename.replace("consumer/packages/safejs/", "")].sha256);
  if (options.disabled) assert.equal(Object.keys(engineFiles).length, 0);
  else assert.ok(engineFiles["consumer/packages/safejs/src/run.ts"] && engineFiles["consumer/packages/safejs/src/interp/interpreter.ts"]);
  report.cohorts[label] = { status: result.status, signal: result.signal, counts, cases, engineFiles,
    packedFiles: [...new Set(loads.filter(row => row.kind === "packed-product").map(row => row.loaded))], pids: [...new Set(loads.map(row => row.pid))] };
  save(label + ".cases.json", report.cohorts[label]);
}
try {
  report.privateBefore = privateState(); save("private-before.json", report.privateBefore);
  assert.equal(report.privateBefore.head, "bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e");
  report.engineCopy = copy(join(privateRoot, "packages/safejs"), copiedEngine); assert.deepEqual(report.engineCopy, report.privateBefore.engine);
  for (const filename of ["tsconfig.json", "LICENSE"]) cpSync(join(privateRoot, filename), join(consumer, filename));
  report.ownInputs = inventory(harness, new Set([...excluded, "evidence"]));
  const archive = join(temporary, "product.tar");
  success(run("archive", "git", ["archive", "-o", archive, revision, "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "README.md", "tests/commands/safejs", "tests/commands/safejs-stress", "tests/integrations/safejs"], repository));
  success(run("extract", "tar", ["-xf", archive, "-C", product])); report.sourceArchiveSha256 = hash(readFileSync(archive)); report.productFiles = inventory(product);
  for (const name of ["typescript", "tsx", "@types/node", "undici-types"]) tool(name, repository);
  for (const name of ["vitest", "memfs"]) tool(name, privateRoot);
  success(run("build", process.execPath, [join(tools, "typescript/bin/tsc"), "-p", "tsconfig.build.json"], product));
  const packed = JSON.parse(success(run("pack", "npm", ["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", temporary], product)).stdout)[0];
  report.packageSha256 = hash(readFileSync(join(temporary, packed.filename)));
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  success(run("install", "npm", ["install", "--offline", "--ignore-scripts", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund", join(temporary, packed.filename)]));
  const installed = join(consumer, "node_modules/virtual-bash"); assert.equal(lstatSync(installed).isSymbolicLink(), false); assert.equal(existsSync(join(installed, "src")), false);
  report.packageManifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")); assert.deepEqual(report.packageManifest.dependencies ?? {}, {});
  report.installedFiles = inventory(installed, new Set()); report.testFiles = copy(join(product, "tests"), join(consumer, "tests"));
  const authorFiles = ["load-proof.mjs", "reporter.mjs", "type-review.mjs", "consumer.ts.fixture", "public-boundary/helpers.mjs", "public-boundary/cancel.child.mjs", "public-boundary/supported.probe.mjs"];
  report.authorHarness = {};
  for (const filename of authorFiles) {
    const bytes = execFileSync("git", ["show", `${authorRevision}:tests/integration/safejs-current-20260827/${filename}`], { cwd: repository, env: environment });
    const destination = join(consumer, filename === "consumer.ts.fixture" ? "consumer.ts" : filename); mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, bytes); report.authorHarness[filename] = hash(bytes);
  }
  copy(harness, join(consumer, "independent"), new Set([...excluded, "evidence"]));
  for (const name of Object.keys(report.installedFiles).filter(name => name.startsWith("dist/") && name.endsWith(".d.ts"))) {
    const destination = join(consumer, "src", name.slice(5)); mkdirSync(dirname(destination), { recursive: true }); cpSync(join(installed, name), destination);
  }
  const guardEnv = { ...environment, SAFEJS_REVIEW_ROOT: temporary, SAFEJS_REVIEW_PROOF: join(output, "guard.imports.ndjson"), NODE_OPTIONS: "--import=" + pathToFileURL(join(consumer, "load-proof.mjs")).href };
  success(run("guard", process.execPath, ["--input-type=module", "-e", `import assert from 'node:assert/strict';await assert.rejects(import(${JSON.stringify(pathToFileURL(join(privateRoot, "packages/safejs/src/run.ts")).href)}),{code:'SAFEJS_REVIEW_OUTSIDE'});await assert.rejects(import(${JSON.stringify(pathToFileURL(join(product, "src/index.ts")).href)}),{message:'Product source fallback'});console.log('private and product-source fallback rejected');`], consumer, guardEnv));
  cohort("author-public", ["public-boundary/supported.probe.mjs"]);
  cohort("independent-public", ["independent/boundary.probe.mjs"]);
  if (process.argv[5] === "full") {
    const commandFiles = ["command", "lifecycle", "local-safejs"].map(name => `tests/commands/safejs/${name}.test.ts`);
    const stressFiles = ["actual-engine", "lifecycle", "safety", "upstream-limitations"].map(name => `tests/commands/safejs-stress/${name}.test.ts`);
    const bridgeFiles = ["filesystem", "memory-shell", "shell", "local-safejs"].map(name => `tests/integrations/safejs/${name}.test.ts`);
    cohort("conventional", [...commandFiles, ...stressFiles]); cohort("bridges", bridgeFiles);
    cohort("desired-original", ["tests/commands/safejs-stress/upstream-desired.probe.ts"]);
    cohort("raw-action-abort", ["tests/commands/safejs-stress/action-abort.probe.ts"]);
    cohort("proposal-invariants", ["tests/commands/safejs-stress/wrapper-invariants.probe.mjs"]);
    cohort("proposal-reasons", ["tests/commands/safejs-stress/reason-contract.probe.mjs"]);
    cohort("unavailable-engine", [...commandFiles, ...stressFiles, ...bridgeFiles], { disabled: true });
    const pair = ["tests/commands/safejs-stress/upstream-limitations.test.ts", "tests/commands/safejs/local-safejs.test.ts"];
    cohort("eight-after", pair, { pattern: "actual current engine: live signal preserves|actual current engine preserves constructed Error messages" });
    const saved = pair.map(filename => readFileSync(join(consumer, filename)));
    try {
      report.eightFixtureDelta = {};
      for (let index = 0; index < pair.length; index++) {
        const filename = pair[index], old = execFileSync("git", ["show", `034a5f0^:${filename}`], { cwd: repository, env: environment });
        report.eightFixtureDelta[filename] = { before: hash(old), after: hash(saved[index]) }; writeFileSync(join(consumer, filename), old);
      }
      cohort("eight-before", pair, { pattern: "KNOWN UPSTREAM LIMITATION: signal loses|upstream observation, not constructor support" });
    } finally { pair.forEach((filename, index) => writeFileSync(join(consumer, filename), saved[index])); }
  }
  const types = run("strict-paired-types", process.execPath, [join(consumer, "type-review.mjs")], consumer, { ...environment, SAFEJS_REVIEW_ROOT: temporary }); report.types = { ...JSON.parse(types.stdout), status: types.status };
  const engineTypes = run("engine-baseline-types", process.execPath, [join(tools, "typescript/bin/tsc"), "--noEmit", "-p", "packages/safejs/tsconfig.json"]);
  report.engineTypes = { status: engineTypes.status, diagnostics: engineTypes.stdout.split("\n").filter(line => line.includes("error TS")) };
  assert.deepEqual(inventory(copiedEngine), report.engineCopy); assert.deepEqual(inventory(join(consumer, "tests")), report.testFiles);
  assert.deepEqual(inventory(installed, new Set()), report.installedFiles);
  report.status = "captured";
} catch (error) { report.status = "infrastructure-failed"; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  report.privateAfter = privateState(); report.privateUnchanged = JSON.stringify(report.privateBefore) === JSON.stringify(report.privateAfter);
  if (!report.privateUnchanged) process.exitCode = 1;
  save("private-after.json", report.privateAfter);
  rmSync(temporary, { recursive: true, force: true }); report.temporaryRemoved = !existsSync(temporary); report.finishedAt = new Date().toISOString();
  save("report.json", report);
  console.log(JSON.stringify({ revision, output, status: report.status, error: report.error, privateUnchanged: report.privateUnchanged, temporaryRemoved: report.temporaryRemoved,
    cohorts: Object.fromEntries(Object.entries(report.cohorts).map(([name, value]) => [name, value.counts])), types: report.types && { baseline: report.types.baseline.diagnostics.length, integration: report.types.integration.diagnostics.length, introduced: report.types.introduced.length }, engineTypes: report.engineTypes?.diagnostics.length }, null, 2));
}
