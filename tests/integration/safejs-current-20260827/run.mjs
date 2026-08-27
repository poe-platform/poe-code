import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const harness = dirname(fileURLToPath(import.meta.url));
const repository = resolve(harness, "../../..");
assert.ok(process.argv[2] && process.argv[3], "Usage: node run.mjs PRIVATE_ROOT OUTSIDE_EVIDENCE_DIRECTORY");
const privateRoot = realpathSync(process.argv[2]);
const output = resolve(process.argv[3]);
assert.ok(!output.startsWith(`${privateRoot}/`) && output !== privateRoot, "Evidence must not write private repository");
assert.ok(!existsSync(output), "Evidence directory must be new");
mkdirSync(output, { recursive: true });
const temporary = realpathSync(mkdtempSync("/tmp/safe-bash-safejs-current-"));
const product = join(temporary, "product");
const consumer = join(temporary, "consumer");
const copiedEngine = join(consumer, "packages/safejs");
const tools = join(temporary, "node_modules");
for (const directory of [product, consumer, tools, join(temporary, "home"), join(temporary, "tmp")]) mkdirSync(directory, { recursive: true });
const environment = {
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(temporary, "home"),
  TMPDIR: join(temporary, "tmp"), TMP: join(temporary, "tmp"), TEMP: join(temporary, "tmp"),
  XDG_CACHE_HOME: join(temporary, "tmp"), LC_ALL: "C", TZ: "UTC", GIT_OPTIONAL_LOCKS: "0",
  TSX_DISABLE_CACHE: "1", npm_config_cache: join(temporary, "npm-cache"),
  npm_config_userconfig: join(temporary, "npmrc"), npm_config_globalconfig: join(temporary, "global-npmrc"),
  npm_config_registry: "http://127.0.0.1:1", npm_config_offline: "true",
  npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false",
};
writeFileSync(environment.npm_config_userconfig, "");
writeFileSync(environment.npm_config_globalconfig, "");
const excluded = new Set(["node_modules", ".git", "dist", ".cache", ".turbo"]);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const commands = [];
const report = { startedAt: new Date().toISOString(), temporary, privateRoot, node: process.version,
  platform: process.platform, arch: process.arch, status: "running", commands, cohorts: {}, tooling: {},
  behavioralAcceptance: false, environment, proposalApplied: false };
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { env: environment, encoding: "utf8" }).trimEnd();
const save = (name, value) => writeFileSync(join(output, name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);

function inventory(root, ignore = excluded) {
  const entries = {};
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      if (ignore.has(name)) continue;
      const filename = join(directory, name);
      const stat = lstatSync(filename);
      assert.ok(!stat.isSymbolicLink(), `Symlink rejected: ${filename}`);
      if (stat.isDirectory()) visit(filename);
      else {
        assert.ok(stat.isFile(), `Nonregular file: ${filename}`);
        entries[relative(root, filename)] = { sha256: digest(readFileSync(filename)), mode: stat.mode & 0o777 };
      }
    }
  }
  visit(root);
  return entries;
}

function privateState() {
  const metadata = {};
  for (const filename of ["AGENTS.md", "package.json", "package-lock.json", "tsconfig.json", "LICENSE", "packages/poe-agent/package.json"]) {
    metadata[filename] = digest(readFileSync(join(privateRoot, filename)));
  }
  return { at: new Date().toISOString(), head: git(privateRoot, "rev-parse", "HEAD"), status: git(privateRoot, "status", "--porcelain=v1"),
    index: digest(readFileSync(resolve(privateRoot, git(privateRoot, "rev-parse", "--git-path", "index")))),
    metadata, engine: inventory(join(privateRoot, "packages/safejs")) };
}

function copyRegular(source, destination, ignore = excluded) {
  const entries = inventory(source, ignore);
  mkdirSync(destination, { recursive: true });
  for (const [filename, info] of Object.entries(entries)) {
    mkdirSync(dirname(join(destination, filename)), { recursive: true });
    const bytes = readFileSync(join(source, filename));
    assert.equal(digest(bytes), info.sha256, `Copy source drift: ${filename}`);
    writeFileSync(join(destination, filename), bytes);
    chmodSync(join(destination, filename), info.mode);
  }
  assert.deepEqual(inventory(destination, ignore), entries);
  return entries;
}

function copyTool(name, sourceModules, optional = false) {
  if (existsSync(join(tools, name))) return;
  let parent = dirname(sourceModules);
  let candidate;
  while (true) {
    const possible = join(parent, "node_modules", name);
    if (existsSync(possible)) { candidate = possible; break; }
    if (dirname(parent) === parent) break;
    parent = dirname(parent);
  }
  if (!candidate) {
    assert.ok(optional, `Missing required cached tooling ${name}`);
    return;
  }
  const source = realpathSync(candidate);
  assert.ok(!source.includes("/packages/"), `Workspace tool link rejected: ${source}`);
  const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  const files = copyRegular(source, join(tools, name), new Set(["node_modules", ".git", ".cache"]));
  report.tooling[name] = { version: manifest.version, source, manifestSha256: digest(readFileSync(join(source, "package.json"))),
    copiedFiles: Object.keys(files).length, treeSha256: digest(JSON.stringify(files)) };
  for (const dependency of Object.keys(manifest.dependencies ?? {})) copyTool(dependency, join(source, "node_modules"));
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) copyTool(dependency, join(source, "node_modules"), true);
}

function run(label, command, args, cwd = consumer, env = environment, timeout = 90_000) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: 32 * 1024 * 1024 });
  const record = { label, command, args, cwd, status: result.status, signal: result.signal,
    error: result.error?.message, durationMs: Date.now() - started };
  commands.push(record);
  save(`${label}.stdout.log`, result.stdout ?? "");
  save(`${label}.stderr.log`, result.stderr ?? "");
  return { ...record, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function requireSuccess(result) {
  assert.equal(result.error, undefined, `${result.label}: ${result.error}`);
  assert.equal(result.status, 0, `${result.label}: ${result.stdout}\n${result.stderr}`);
}

function cohort(label, files, enabled = true) {
  const proof = join(output, `${label}.imports.ndjson`);
  const env = { ...environment, SAFEJS_REVIEW_ROOT: temporary, SAFEJS_REVIEW_PROOF: proof,
    SAFEJS_FORBIDDEN_ROOT: privateRoot,
    NODE_OPTIONS: `--import=${pathToFileURL(join(consumer, "load-proof.mjs")).href}`,
    ...(enabled ? { SAFEJS_LOCAL_ROOT: copiedEngine } : {}),
  };
  const result = run(label, process.execPath, ["--unhandled-rejections=strict", "--max-old-space-size=768", "--import", "tsx",
    "--test", "--test-concurrency=1", "--test-timeout=20000", `--test-reporter=${join(consumer, "reporter.mjs")}`, ...files], consumer, env, 180_000);
  assert.equal(result.error, undefined, `Cohort infrastructure error: ${result.error}`);
  const events = result.stdout.split("\n").filter(Boolean).map(line => JSON.parse(line));
  const cases = events.filter(event => ["test:pass", "test:fail"].includes(event.type) && event.data.nesting === 0)
    .map(event => ({ outcome: event.data.skip ? "skip" : event.type === "test:pass" ? "pass" : "fail", ...event.data }));
  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const entry of cases) counts[entry.outcome] += 1;
  report.cohorts[label] = { enabled, status: result.status, signal: result.signal, counts, cases };
  assert.ok(cases.length > 0, `No cases captured: ${label}`);
  save(`${label}.cases.json`, report.cohorts[label]);
}

try {
  report.privateBefore = privateState();
  save("private-before.json", report.privateBefore);
  report.productHead = git(repository, "rev-parse", "HEAD");
  report.productStatus = git(repository, "status", "--porcelain=v1");
  report.harnessHashes = inventory(harness);
  report.engineCopy = copyRegular(join(privateRoot, "packages/safejs"), copiedEngine);
  report.enginePackage = JSON.parse(readFileSync(join(copiedEngine, "package.json"), "utf8"));
  for (const filename of ["tsconfig.json", "LICENSE"]) cpSync(join(privateRoot, filename), join(consumer, filename));
  report.privateAfterCopy = privateState();
  assert.deepEqual(report.privateAfterCopy.engine, report.privateBefore.engine, "Engine changed during snapshot");
  const proposal = JSON.parse(readFileSync(join(repository, "docs/upstream-patches/safejs/patch-manifest.json"), "utf8"));
  report.proposalComparison = Object.fromEntries(Object.entries(proposal.files).map(([filename, hashes]) => {
    const current = report.engineCopy[filename.replace(/^packages\/safejs\//u, "")].sha256;
    return [filename, { ...hashes, current, matchesOldBaseline: current === hashes.before, matchesProposal: current === hashes.after }];
  }));
  save("upstream-history.txt", git(privateRoot, "log", "-15", "--format=%H %aI %s", "--", "packages/safejs"));
  save("upstream-delta-stat.txt", git(privateRoot, "diff", "--stat", `${proposal.baselineRevision}..${report.privateBefore.head}`, "--", "packages/safejs"));
  const archive = join(temporary, "product.tar");
  requireSuccess(run("archive-product", "git", ["archive", "--format=tar", `--output=${archive}`, report.productHead,
    "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "README.md",
    "tests/commands/safejs", "tests/commands/safejs-stress", "tests/integrations/safejs"], repository));
  requireSuccess(run("extract-product", "tar", ["-xf", archive, "-C", product]));
  report.productArchiveSha256 = digest(readFileSync(archive));
  for (const name of ["typescript", "tsx", "@types/node", "undici-types"]) copyTool(name, join(repository, "node_modules"));
  copyTool("vitest", join(privateRoot, "node_modules"));
  copyTool("memfs", join(privateRoot, "node_modules"));
  requireSuccess(run("build-product", process.execPath, [join(tools, "typescript/bin/tsc"), "-p", "tsconfig.build.json"], product));
  const pack = run("pack-product", "npm", ["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", temporary], product);
  requireSuccess(pack);
  const artifact = JSON.parse(pack.stdout)[0];
  report.package = { name: artifact.name, version: artifact.version, sha256: digest(readFileSync(join(temporary, artifact.filename))) };
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  requireSuccess(run("install-product", "npm", ["install", "--offline", "--ignore-scripts", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund", join(temporary, artifact.filename)]));
  const installed = join(consumer, "node_modules/virtual-bash");
  assert.equal(lstatSync(installed).isSymbolicLink(), false);
  report.package.manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.deepEqual(report.package.manifest.dependencies ?? {}, {});
  assert.equal(existsSync(join(installed, "src")), false);
  report.fixtureHashes = copyRegular(join(product, "tests"), join(consumer, "tests"));
  report.fixtureHistoricalComparison = {};
  for (const [filename, info] of Object.entries(report.fixtureHashes)) {
    try {
      const old = execFileSync("git", ["show", `fa6c095:tests/${filename}`], { cwd: repository, env: environment, stdio: ["ignore", "pipe", "pipe"] });
      report.fixtureHistoricalComparison[filename] = { current: info.sha256, fa6c095: digest(old), unchanged: digest(old) === info.sha256 };
    } catch { report.fixtureHistoricalComparison[filename] = { current: info.sha256, fa6c095: null }; }
  }
  const declarationFiles = inventory(join(installed, "dist"));
  report.declarationMirror = {};
  for (const [filename, info] of Object.entries(declarationFiles)) {
    if (!filename.endsWith(".d.ts")) continue;
    mkdirSync(dirname(join(consumer, "src", filename)), { recursive: true });
    cpSync(join(installed, "dist", filename), join(consumer, "src", filename));
    report.declarationMirror[filename] = info;
  }
  for (const filename of ["load-proof.mjs", "reporter.mjs", "type-review.mjs"]) cpSync(join(harness, filename), join(consumer, filename));
  cpSync(join(harness, "consumer.ts.fixture"), join(consumer, "consumer.ts"));
  const guardEnv = { ...environment, SAFEJS_REVIEW_ROOT: temporary,
    SAFEJS_REVIEW_PROOF: join(output, "guard-controls.imports.ndjson"),
    NODE_OPTIONS: `--import=${pathToFileURL(join(consumer, "load-proof.mjs")).href}` };
  const guardSource = [
    'import assert from "node:assert/strict";',
    `await assert.rejects(import(${JSON.stringify(pathToFileURL(join(privateRoot, "packages/safejs/src/run.ts")).href)}), { code: "SAFEJS_REVIEW_OUTSIDE" });`,
    `await assert.rejects(import(${JSON.stringify(pathToFileURL(join(product, "src/index.ts")).href)}), { message: "Product source fallback" });`,
    'console.log(JSON.stringify({ privateSourceRejected: true, productSourceRejected: true }));',
  ].join("\n");
  const guardResult = run("guard-controls", process.execPath, ["--input-type=module", "-e", guardSource], consumer, guardEnv);
  requireSuccess(guardResult);
  report.guardControls = JSON.parse(guardResult.stdout);
  const commandsFiles = ["command", "lifecycle", "local-safejs"].map(name => `tests/commands/safejs/${name}.test.ts`);
  const stressFiles = ["actual-engine", "lifecycle", "safety", "upstream-limitations"].map(name => `tests/commands/safejs-stress/${name}.test.ts`);
  const bridgeFiles = ["filesystem", "memory-shell", "shell", "local-safejs"].map(name => `tests/integrations/safejs/${name}.test.ts`);
  if (process.argv[4] === "public-boundary") {
    report.publicFixtureHashes = copyRegular(join(harness, "public-boundary"), join(consumer, "public-boundary"));
    cohort("public-boundary", ["public-boundary/supported.probe.mjs"]);
  } else {
    cohort("conventional", [...commandsFiles, ...stressFiles]);
    cohort("bridges", bridgeFiles);
    cohort("desired-original-plus-action", ["tests/commands/safejs-stress/upstream-desired.probe.ts", "tests/commands/safejs-stress/action-abort.probe.ts"]);
    cohort("proposal-invariants", ["tests/commands/safejs-stress/wrapper-invariants.probe.mjs"]);
    cohort("proposal-reason-profile", ["tests/commands/safejs-stress/reason-contract.probe.mjs"]);
    cohort("unavailable-engine", [...commandsFiles, ...stressFiles, ...bridgeFiles], false);
    const unavailableCases = new Map(report.cohorts["unavailable-engine"].cases.map(entry => [entry.name, entry]));
    report.classification = {};
    for (const label of ["conventional", "bridges"]) {
      const groups = {};
      for (const entry of report.cohorts[label].cases) {
        assert.ok(unavailableCases.has(entry.name), `Unpaired case: ${entry.name}`);
        const category = /^(KNOWN UPSTREAM LIMITATION:|upstream observation, not constructor support:)/u.test(entry.name)
          ? "defect-characterization"
          : /structurally assignable/u.test(entry.name) ? "structural-type-probe"
          : unavailableCases.get(entry.name).outcome === "skip" ? "actual-engine-behavior" : "fixture-or-configuration";
        groups[category] ??= { pass: 0, fail: 0, skip: 0, names: [] };
        groups[category][entry.outcome] += 1;
        groups[category].names.push(entry.name);
      }
      report.classification[label] = groups;
    }
  }
  report.importProof = {};
  for (const label of Object.keys(report.cohorts)) {
    const events = readFileSync(join(output, `${label}.imports.ndjson`), "utf8").trim().split("\n").map(line => JSON.parse(line));
    const engineFiles = new Map(events.filter(event => event.kind === "actual-engine-copy").map(event => [event.loaded, event.sha256]));
    for (const [filename, hash] of engineFiles) assert.equal(hash, report.engineCopy[filename.replace(/^consumer\/packages\/safejs\//u, "")].sha256);
    if (label === "unavailable-engine") assert.equal(engineFiles.size, 0);
    else for (const required of ["run.ts", "interp/interpreter.ts"]) {
      assert.ok(engineFiles.has(`consumer/packages/safejs/src/${required}`), `${label}: no actual ${required} load`);
    }
    report.importProof[label] = {
      engineFiles: Object.fromEntries(engineFiles),
      packedProductFiles: [...new Set(events.filter(event => event.kind === "packed-product").map(event => event.loaded))].sort(),
      pids: [...new Set(events.map(event => event.pid))],
    };
  }
  const typeReview = run("integration-type-review", process.execPath, [join(consumer, "type-review.mjs")], consumer,
    { ...environment, SAFEJS_REVIEW_ROOT: temporary });
  report.typeReview = JSON.parse(typeReview.stdout);
  report.typeReview.status = typeReview.status;
  const typecheck = run("current-upstream-typecheck", process.execPath,
    [join(tools, "typescript/bin/tsc"), "--noEmit", "--project", "packages/safejs/tsconfig.json"], consumer);
  report.upstreamTypecheck = { status: typecheck.status, diagnostics: typecheck.stdout.split("\n").filter(line => line.includes("error TS")) };
  const historicalDiagnostics = readFileSync(join(repository, "docs/upstream-patches/safejs/evidence/v3/typecheck.log"), "utf8")
    .split("\n").filter(line => line.includes("error TS"));
  report.upstreamTypecheck.matchesHistoricalEight = JSON.stringify(report.upstreamTypecheck.diagnostics) === JSON.stringify(historicalDiagnostics);
  report.engineAfterTests = inventory(copiedEngine);
  assert.deepEqual(report.engineAfterTests, report.engineCopy, "Copied engine source changed during tests");
  assert.deepEqual(inventory(join(consumer, "tests")), report.fixtureHashes, "Unchanged fixtures were modified");
  report.privateAfter = privateState();
  save("private-after.json", report.privateAfter);
  report.privateDrift = Object.fromEntries(["head", "status", "index", "metadata", "engine"].map(key => [key,
    JSON.stringify(report.privateBefore[key]) !== JSON.stringify(report.privateAfter[key])]));
  report.status = "completed-with-observations";
} catch (error) {
  report.status = "infrastructure-failure";
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  if (!report.privateAfter) {
    try {
      report.privateAfter = privateState();
      save("private-after.json", report.privateAfter);
      report.privateDrift = Object.fromEntries(["head", "status", "index", "metadata", "engine"].map(key => [key,
        JSON.stringify(report.privateBefore?.[key]) !== JSON.stringify(report.privateAfter[key])]));
    } catch (error) { report.privateFinalObservationError = error.message; }
  }
  rmSync(temporary, { recursive: true, force: true });
  report.temporaryRemoved = !existsSync(temporary);
  report.finishedAt = new Date().toISOString();
  save("report.json", report);
  save("commands.json", commands);
  process.stdout.write(`${JSON.stringify({ status: report.status, productHead: report.productHead, engineHead: report.privateBefore?.head,
    cohorts: Object.fromEntries(Object.entries(report.cohorts).map(([name, value]) => [name, { status: value.status, ...value.counts }])),
    error: report.error, output }, null, 2)}\n`);
}
