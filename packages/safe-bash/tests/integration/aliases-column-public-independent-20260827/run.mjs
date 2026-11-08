import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { families, nestedOption, specifiers, validateDeclaration } from "./contract.mjs";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../..");
const args = process.argv.slice(2);
assert.ok(args.length === 2 && ["--baseline", "--candidate"].includes(args[0]), "usage: node run.mjs --baseline FULL_COMMIT | --candidate DECLARATION.json");
const configuration = args[0] === "--baseline" ? { mode: "baseline", sourceCommit: args[1] } : { mode: "candidate", declaration: validateDeclaration(JSON.parse(readFileSync(resolve(args[1])))) };
const sourceCommit = configuration.sourceCommit ?? configuration.declaration.candidateCommit;
assert.match(sourceCommit, /^[a-f0-9]{40}$/);
const directory = realpathSync(mkdtempSync(join(tmpdir(), "aliases-column-public-freeze-")));
const environment = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: directory, TMPDIR: directory, LC_ALL: "C", LANG: "C", TZ: "UTC", npm_config_cache: join(directory, "npm-cache"), npm_config_userconfig: join(directory, "empty.npmrc"), npm_config_globalconfig: join(directory, "empty-global.npmrc") };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const report = { schema: 1, scope: "independent pre-candidate public integration fixture freeze", started: new Date().toISOString(), directory, configuration, sourceCommit, node: process.version, steps: [], fixtureFiles: {}, candidateAcceptance: "NOT RUN" };
console.log(`Isolated evidence: ${directory}`);
function command(name, binary, argv, cwd = directory, extra = {}) {
  const result = spawnSync(binary, argv, { cwd, env: environment, encoding: "utf8", timeout: 180000, maxBuffer: 32 * 1024 * 1024, ...extra });
  const record = { name, command: [binary, ...argv], cwd, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  report.steps.push(record);
  json(join(directory, `${String(report.steps.length).padStart(2, "0")}-${name}.json`), record);
  return record;
}
function success(record) {
  const detail = `${record.name}: status=${record.status}, signal=${record.signal}, error=${record.error}; see isolated step JSON`;
  assert.equal(record.error, undefined, detail);
  assert.equal(record.signal, null, detail);
  assert.equal(record.status, 0, detail);
  return record;
}
function tree(path, prefix = "") {
  const result = {};
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((first, second) => first.name.localeCompare(second.name))) {
    const relative = `${prefix}${entry.name}`;
    assert.equal(entry.isSymbolicLink(), false, `unexpected symlink: ${relative}`);
    if (entry.isDirectory()) Object.assign(result, tree(join(path, entry.name), `${relative}/`));
    else result[relative] = hash(readFileSync(join(path, entry.name)));
  }
  return result;
}
function runtime(name, cwd, argv) {
  return command(name, process.execPath, ["--experimental-permission", `--allow-fs-read=${cwd}`, "--allow-worker", "--unhandled-rejections=strict", ...argv], cwd);
}
function controlCopy(name, consumer) {
  const destination = join(directory, name);
  cpSync(consumer, destination, { recursive: true });
  return destination;
}
try {
  assert.equal(success(command("git-root", "git", ["rev-parse", "--show-toplevel"], repository)).stdout.trim(), repository);
  report.liveStatusBefore = success(command("live-status-before", "git", ["status", "--porcelain=v1"], repository)).stdout;
  assert.equal(success(command("commit-identity", "git", ["rev-parse", `${sourceCommit}^{commit}`], repository)).stdout.trim(), sourceCommit);
  for (const entry of readdirSync(owned)) if (lstatSync(join(owned, entry)).isFile()) report.fixtureFiles[entry] = hash(readFileSync(join(owned, entry)));
  report.fixtureTree = tree(owned);
  if (configuration.mode === "candidate") {
    const fixtureArchive = spawnSync("git", ["archive", "--format=tar", configuration.declaration.fixtureCommit, "tests/integration/aliases-column-public-independent-20260827"], { cwd: repository, env: environment, maxBuffer: 32 * 1024 * 1024 });
    assert.equal(fixtureArchive.status, 0);
    writeFileSync(join(directory, "fixtures.tar"), fixtureArchive.stdout, { flag: "wx" });
    const frozen = join(directory, "frozen-fixtures");
    mkdirSync(frozen);
    success(command("extract-frozen-fixtures", "/usr/bin/tar", ["-xf", join(directory, "fixtures.tar"), "-C", frozen]));
    assert.deepEqual(tree(join(frozen, "tests/integration/aliases-column-public-independent-20260827")), report.fixtureTree, "fixtures differ from declared freeze commit, including new entries");
    report.fixtureArchiveSha256 = hash(fixtureArchive.stdout);
  }
  const archive = spawnSync("git", ["archive", "--format=tar", sourceCommit, "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"], { cwd: repository, env: environment, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(archive.status, 0, archive.stderr.toString());
  const archivePath = join(directory, "source.tar");
  writeFileSync(archivePath, archive.stdout, { flag: "wx" });
  report.archiveSha256 = hash(archive.stdout);
  const source = join(directory, "committed-source");
  mkdirSync(source);
  success(command("extract-source", "/usr/bin/tar", ["-xf", archivePath, "-C", source]));
  report.sourceTree = tree(source);
  const packageJson = JSON.parse(readFileSync(join(source, "package.json")));
  assert.equal(packageJson.name, "virtual-bash");
  assert.equal(packageJson.type, "module");
  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.deepEqual(packageJson.optionalDependencies ?? {}, {});
  for (const name of ["prepack", "prepare", "postpack", "preinstall", "install", "postinstall"]) assert.equal(packageJson.scripts?.[name], undefined, `unreviewed lifecycle script: ${name}`);
  if (configuration.mode === "candidate") assert.deepEqual(packageJson.exports, configuration.declaration.packageExports, "candidate exports differ from explicit root declaration");
  report.packageExports = packageJson.exports;
  const compiler = join(repository, "node_modules/typescript/bin/tsc");
  report.compiler = { path: realpathSync(compiler), sha256: hash(readFileSync(compiler)), implementationSha256: hash(readFileSync(join(repository, "node_modules/typescript/lib/_tsc.js"))), version: JSON.parse(readFileSync(join(repository, "node_modules/typescript/package.json"))).version };
  symlinkSync(join(repository, "node_modules"), join(source, "node_modules"), "dir");
  success(command("isolated-build", process.execPath, [compiler, "-p", "tsconfig.build.json"], source));
  rmSync(join(source, "node_modules"));
  report.builtTree = tree(join(source, "dist"));
  report.npm = success(command("npm-version", "npm", ["--version"])).stdout.trim();
  const packed = success(command("pack", "npm", ["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", directory], source));
  const metadata = JSON.parse(packed.stdout);
  assert.equal(metadata.length, 1);
  const tarball = join(directory, metadata[0].filename);
  report.pack = { ...metadata[0], sha256: hash(readFileSync(tarball)) };
  assert.deepEqual(tree(join(source, "dist")), report.builtTree);
  const original = join(directory, "consumer-original");
  mkdirSync(join(original, "node_modules"), { recursive: true });
  success(command("install-packed-artifact", "/usr/bin/tar", ["-xzf", tarball, "-C", join(original, "node_modules")]));
  renameSync(join(original, "node_modules/package"), join(original, "node_modules/virtual-bash"));
  for (const name of ["consumer.mjs", "contract.mjs", "cases.json"]) cpSync(join(owned, name), join(original, name));
  json(join(original, "package.json"), { name: "independent-moved-public-consumer", private: true, type: "module" });
  json(join(original, "configuration.json"), configuration);
  const consumer = join(directory, "consumer-moved");
  renameSync(original, consumer);
  assert.equal(existsSync(original), false);
  const installed = join(consumer, "node_modules/virtual-bash");
  assert.equal(lstatSync(installed).isSymbolicLink(), false);
  assert.equal(existsSync(join(installed, "src")), false);
  report.installedTreeBefore = tree(installed);
  assert.deepEqual(tree(join(installed, "dist")), report.builtTree);
  renameSync(source, join(directory, "committed-source-retired"));
  mkdirSync(join(consumer, "node_modules/@types"), { recursive: true });
  cpSync(join(repository, "node_modules/@types/node"), join(consumer, "node_modules/@types/node"), { recursive: true });
  cpSync(join(repository, "node_modules/undici-types"), join(consumer, "node_modules/undici-types"), { recursive: true });
  report.consumerTypeDependencies = { node: tree(join(consumer, "node_modules/@types/node")), undici: tree(join(consumer, "node_modules/undici-types")) };
  const compilerOptions = { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true, skipLibCheck: false, noEmit: true, types: ["node"], typeRoots: [join(consumer, "node_modules/@types")] };
  const aliasSpecifier = specifiers(configuration, "aliases")[0];
  const columnSpecifier = specifiers(configuration, "column")[0];
  const agentOptions = configuration.mode === "candidate" ? nestedOption(configuration.declaration.agentOptions.regex, { requestTimeoutMs: 37 }) : {};
  let positive = readFileSync(join(owned, "positive.ts.fixture"), "utf8").replaceAll("__ALIASES__", aliasSpecifier).replaceAll("__COLUMN__", columnSpecifier).replaceAll("__AGENT_OPTIONS__", JSON.stringify(agentOptions));
  if (configuration.mode === "candidate") {
    const columnOptions = JSON.stringify(nestedOption(configuration.declaration.agentOptions.column, { limits: { maxRows: 2 } }));
    positive += `\nagentCommands(${columnOptions});\ncreateAgentCommands(${columnOptions});\n`;
  }
  for (const [family, names] of Object.entries(families)) for (const [index, specifier] of specifiers(configuration, family).entries()) {
    positive += `\nimport { ${names.map(name => `${name} as ${name}${index}`).join(", ")} } from ${JSON.stringify(specifier)};\n`;
  }
  const invalidAgent = configuration.mode === "candidate" ? nestedOption(configuration.declaration.agentOptions.regex, { requestTimeoutMs: "fast" }) : { replace: "yes" };
  const invalidColumn = configuration.mode === "candidate" ? nestedOption(configuration.declaration.agentOptions.column, { limits: { maxRows: "many" } }) : { replace: "yes" };
  const negative = readFileSync(join(owned, "negative.ts.fixture"), "utf8").replaceAll("__ALIASES__", aliasSpecifier).replaceAll("__COLUMN__", columnSpecifier).replaceAll("__INVALID_AGENT_REGEX__", JSON.stringify(invalidAgent)).replaceAll("__INVALID_AGENT_COLUMN__", JSON.stringify(invalidColumn));
  report.aggregateTypeChecks = { status: configuration.mode === "candidate" ? "four independent invalid regex/column calls" : "future regex/column routes DEFERRED; four replace-invalid controls only", lines: { agentRegex: 13, definitionsRegex: 14, agentColumn: 15, definitionsColumn: 16 } };
  writeFileSync(join(consumer, "positive.ts"), positive, { flag: "wx" });
  writeFileSync(join(consumer, "negative.ts"), negative, { flag: "wx" });
  json(join(consumer, "tsconfig.positive.json"), { compilerOptions, files: ["positive.ts"] });
  json(join(consumer, "tsconfig.negative.json"), { compilerOptions, files: ["negative.ts"] });
  success(command("strict-positive-types", process.execPath, [compiler, "-p", "tsconfig.positive.json", "--traceResolution"], consumer));
  const rejected = command("strict-negative-types", process.execPath, [compiler, "-p", "tsconfig.negative.json"], consumer);
  assert.equal(rejected.status, 2);
  assert.equal(rejected.signal, null);
  const diagnostics = [...rejected.stdout.matchAll(/negative\.ts\((\d+),\d+\): error TS(\d+):/g)];
  const expectedLines = Array.from({ length: 13 }, (_, index) => index + 4);
  assert.deepEqual(diagnostics.map(match => Number(match[1])), expectedLines);
  assert.ok(diagnostics.every(match => ["2322", "2353", "2339"].includes(match[2])), "type failures must be actual invalid API use, not missing modules");
  report.typeNegativeLines = expectedLines;
  const runtimeRecord = command("moved-consumer", process.execPath, ["--experimental-permission", `--allow-fs-read=${consumer}`, "--allow-worker", "--unhandled-rejections=strict", "consumer.mjs"], consumer);
  if (runtimeRecord.stdout.trim()) report.runtime = JSON.parse(runtimeRecord.stdout);
  success(runtimeRecord);
  if (configuration.mode === "baseline") {
    report.expectedRed = [];
    for (const [family, names] of Object.entries(families)) {
      const record = runtime(`baseline-missing-public-${family}`, consumer, ["--input-type=module", "-e", `import { ${names.join(", ")} } from 'virtual-bash';`]);
      assert.equal(record.status, 1);
      assert.match(record.stderr, /does not provide an export named/);
      report.expectedRed.push({ assertion: `${family} root public import`, status: "EXPECTED RED", observedStatus: record.status });
    }
    const count = runtime("baseline-exact-73-negative", consumer, ["--input-type=module", "-e", "import assert from 'node:assert/strict'; import { createAgentCommands } from 'virtual-bash'; assert.equal(createAgentCommands().length, 73);"]);
    assert.equal(count.status, 1);
    assert.match(count.stderr, /70 !== 73/);
    report.expectedRed.push({ assertion: "exactly 73 default definitions", status: "EXPECTED RED", observedStatus: count.status });
  }
  for (const loaded of report.runtime.loaded) {
    const relative = fileURLToPath(loaded.url).slice(installed.length + 1);
    assert.equal(loaded.sha256, report.installedTreeBefore[relative], `actual loaded bytes differ: ${relative}`);
  }
  for (const worker of report.runtime.workers) assert.equal(worker.sha256, report.installedTreeBefore[worker.path.slice(installed.length + 1)]);
  const missing = controlCopy("control-missing-export", consumer);
  const missingPackagePath = join(missing, "node_modules/virtual-bash/package.json");
  const missingJson = JSON.parse(readFileSync(missingPackagePath));
  const removedSpecifiers = configuration.mode === "candidate" ? [...new Set(["virtual-bash", ...Object.keys(families).flatMap(family => specifiers(configuration, family))])] : ["virtual-bash", "virtual-bash/commands/table-text"];
  for (const specifier of removedSpecifiers) delete missingJson.exports[specifier === "virtual-bash" ? "." : specifier.replace("virtual-bash/", "./")];
  writeFileSync(missingPackagePath, JSON.stringify(missingJson));
  for (const [index, specifier] of removedSpecifiers.entries()) {
    const record = runtime(`missing-export-${index}`, missing, ["--input-type=module", "-e", `await import(${JSON.stringify(specifier)})`]);
    assert.equal(record.status, 1);
    assert.match(record.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/);
  }
  const fallback = controlCopy("control-source-fallback", consumer);
  writeFileSync(join(fallback, "node_modules/virtual-bash/dist/index.js"), `export * from ${JSON.stringify(pathToFileURL(join(repository, "src/index.ts")).href)};\n`);
  const denied = runtime("source-fallback-poisoned-entry", fallback, ["consumer.mjs"]);
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /ERR_ACCESS_DENIED|product source fallback/);
  const directDenied = runtime("source-read-permission-negative", consumer, ["--input-type=module", "-e", `import { readFileSync } from 'node:fs'; readFileSync(${JSON.stringify(join(repository, "src/index.ts"))});`]);
  assert.equal(directDenied.status, 1);
  assert.match(directDenied.stderr, /ERR_ACCESS_DENIED/);
  const layout = controlCopy("control-worker-layout", consumer);
  const workerPaths = [...new Set(report.runtime.workers.map(worker => worker.path.slice(installed.length + 1)))];
  assert.equal(workerPaths.length, 1);
  for (const path of workerPaths) renameSync(join(layout, "node_modules/virtual-bash", path), join(layout, "node_modules/virtual-bash", `${path}.removed`));
  const layoutResult = success(runtime("worker-layout-negative", layout, ["consumer.mjs", "worker-layout-control"]));
  report.workerLayoutControl = JSON.parse(layoutResult.stdout);
  const wrongExpected = controlCopy("control-wrong-expected-output", consumer);
  const wrongCases = JSON.parse(readFileSync(join(wrongExpected, "cases.json")));
  wrongCases.cases[0].stdout = "deliberately incorrect expected bytes\n";
  writeFileSync(join(wrongExpected, "cases.json"), JSON.stringify(wrongCases));
  const wrongResult = runtime("expected-output-mutation-negative", wrongExpected, ["consumer.mjs"]);
  assert.equal(wrongResult.status, 1);
  const wrongReport = JSON.parse(wrongResult.stdout);
  assert.deepEqual(wrongReport.results.filter(result => result.status === "FAIL").map(result => result.id), [`${configuration.mode === "baseline" ? "internal-composition-probe" : "public-default"}:extended-alternation`]);
  report.expectedOutputMutation = { status: "PASS: deliberately wrong bytes rejected", totals: wrongReport.totals };
  report.installedTreeAfter = tree(installed);
  assert.deepEqual(report.installedTreeAfter, report.installedTreeBefore, "installed tree changed, including added entries");
  assert.equal(hash(readFileSync(archivePath)), report.archiveSha256);
  const retiredTree = tree(join(directory, "committed-source-retired"));
  for (const path of Object.keys(retiredTree)) if (path.startsWith("dist/")) delete retiredTree[path];
  assert.deepEqual(retiredTree, report.sourceTree, "archive inputs changed, including added entries");
  for (const [name, digest] of Object.entries(report.fixtureFiles)) assert.equal(hash(readFileSync(join(owned, name))), digest, `frozen fixture changed during run: ${name}`);
  assert.deepEqual(tree(owned), report.fixtureTree, "fixture inventory changed, including new entries");
  report.liveStatusAfter = success(command("live-status-after", "git", ["status", "--porcelain=v1"], repository)).stdout;
  report.controls = { missingExport: "PASS", sourceFallback: "PASS", workerLayout: "PASS", typeNegative: "PASS", expectedOutputMutation: "PASS", beforeAfterInventory: "PASS including new file entries" };
  report.candidateAcceptance = configuration.mode === "candidate" ? "PASS scoped frozen integration fixtures only" : "NOT RUN / EXPECTED RED: baseline has 70 defaults and lacks public family symbols; internal probes are not integration passes";
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  json(join(directory, "report.json"), report);
  console.log(JSON.stringify({ status: report.status, candidateAcceptance: report.candidateAcceptance, runtime: report.runtime?.totals, report: join(directory, "report.json"), error: report.error }, null, 2));
}
