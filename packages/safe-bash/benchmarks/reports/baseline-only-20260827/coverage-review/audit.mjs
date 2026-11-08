import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const root = "/Users/kjopek/Workspace/safe-bash";
assert.equal(process.cwd(), root);
const cohort = "benchmarks/reports/baseline-only-20260827";
const baselineRoot = "benchmarks/node_modules/just-bash";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = path => JSON.parse(readFileSync(path, "utf8"));
const read = path => readFileSync(path, "utf8");
const ordered = values => [...new Set(values)].sort();
const git = args => execFileSync("git", args, { encoding: "utf8" }).trimEnd();

function file(path) {
  const absolute = resolve(path);
  const stat = lstatSync(absolute);
  const resolved = realpathSync(absolute);
  const links = [];
  let current = sep;
  for (const component of absolute.split(sep).filter(Boolean)) {
    current = join(current, component);
    if (lstatSync(current).isSymbolicLink()) links.push({ path: current, target: readlinkSync(current), realpath: realpathSync(current) });
  }
  return { path, realpath: resolved, kind: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file", links,
    ...(lstatSync(resolved).isFile() ? { bytes: readFileSync(resolved).length, sha256: hash(readFileSync(resolved)) } : {}) };
}

function tree(path) {
  const entries = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isSymbolicLink()) entries.push({ path: child, kind: "symlink", target: readlinkSync(child), realpath: realpathSync(child) });
      else if (entry.isFile()) entries.push({ path: child, kind: "file", bytes: lstatSync(child).size, sha256: hash(readFileSync(child)) });
      else throw new Error(`Unexpected nonregular entry: ${child}`);
    }
  }
  visit(path);
  return { path, entries: entries.length, bytes: entries.reduce((total, entry) => total + (entry.bytes ?? 0), 0), manifestSha256: hash(JSON.stringify(entries)), symlinks: entries.filter(entry => entry.kind === "symlink") };
}

const casesPath = `${cohort}/coverage-execution/cases.mjs`;
const caseFileBefore = file(casesPath);
const inventoryPath = `${cohort}/coverage-setup/inventory.json`;
const inventoryFileBefore = file(inventoryPath);
const setup = json(inventoryPath);
const declarations = await import(pathToFileURL(resolve(casesPath)).href);
const validation = declarations.validateCases(setup);
assert.equal(caseFileBefore.sha256, file(casesPath).sha256, "Case declarations changed during import");
assert.equal(inventoryFileBefore.sha256, file(inventoryPath).sha256, "Inventory changed during read");

const standardSources = ["basic", "filesystem", "streams", "text", "grep", "execution", "find"].map(name => `src/commands/${name}.ts`);
const registrationEvidence = standardSources.flatMap(path => [...read(path).matchAll(/define\("([^\"]+)"/g)].map(match => ({ name: match[1], path })));
registrationEvidence.push(...["head", "tail"].map(name => ({ name, path: "src/commands/streams.ts" })));
registrationEvidence.push(...["test", "["].map(name => ({ name, path: "src/commands/predicates.ts" })));
const familySources = {
  sed: "text-programs/sed.ts", awk: "text-programs/awk.ts", jq: "structured/jq.ts", rg: "search/rg.ts",
  base32: "bytes/encoding/index.ts", base64: "bytes/encoding/index.ts", xxd: "bytes/encoding/index.ts", od: "bytes/encoding/index.ts",
  sha256sum: "bytes/checksums/index.ts", sha1sum: "bytes/checksums/index.ts", md5sum: "bytes/checksums/index.ts", cksum: "bytes/checksums/index.ts",
  gzip: "bytes/compression/index.ts", gunzip: "bytes/compression/index.ts", zcat: "bytes/compression/index.ts",
  diff: "diff-patch/diff.ts", patch: "diff-patch/patch.ts", chmod: "metadata/chmod.ts", stat: "metadata/stat.ts", mktemp: "metadata/mktemp.ts",
  tar: "archive/index.ts", paste: "table-text/paste.ts", comm: "table-text/comm.ts", join: "table-text/join.ts",
};
for (const [name, tail] of Object.entries(familySources)) {
  const path = `src/commands/${tail}`;
  assert.ok(read(path).includes(name), `Review concrete command definition: ${name}`);
  registrationEvidence.push({ name, path });
}
const oursRegistered = ordered(registrationEvidence.map(entry => entry.name));
assert.equal(oursRegistered.length, registrationEvidence.length, "Unexpected duplicate source registration");
assert.deepEqual(oursRegistered, setup.current.virtual.registered);
const runtime = read("src/shell/runtime.ts");
const classifiedBody = runtime.match(/const shellBuiltinNames = new Set\(\[([\s\S]*?)\]\)/)?.[1];
assert.ok(classifiedBody);
const oursClassified = ordered([...classifiedBody.matchAll(/"([^\"]+)"/g)].map(match => match[1]));
assert.ok(runtime.includes('const implementedBuiltins = new Set([...shellBuiltinNames].filter(name => !["echo", "printf", "test", "["].includes(name)))'));
assert.ok(runtime.includes('if (implementedBuiltins.has(name)) matches.push({ kind: "builtin", name })'));
const oursKernel = oursClassified.filter(name => !["echo", "printf", "test", "["].includes(name));
assert.deepEqual(oursKernel, setup.current.virtual.kernel);
const oursUnion = ordered([...oursRegistered, ...oursKernel, "bash", "sh"]);

const bundlePath = `${baselineRoot}/dist/bundle/index.js`;
const bundle = read(bundlePath);
const registry = [...bundle.matchAll(/\{name:"([^\"]+)",load:async\(\)=>\(await import\("([^\"]+)"\)\)\.([\w$]+)/g)]
  .map(match => ({ name: match[1], import: match[2], exported: match[3], offset: Buffer.byteLength(bundle.slice(0, match.index)) }));
const optionalNames = ["curl", "js-exec", "node", "python", "python3"];
const baselineRegistered = ordered(registry.filter(entry => !optionalNames.includes(entry.name)).map(entry => entry.name));
assert.deepEqual(baselineRegistered, setup.current.baseline.registered);
const dispatchPosition = bundle.indexOf('if(t==="cd")');
assert.ok(dispatchPosition > 0);
const dispatcher = bundle.slice(bundle.lastIndexOf("async function ", dispatchPosition), bundle.indexOf("async function ", dispatchPosition));
const baselineKernel = ordered([...dispatcher.matchAll(/t==="([^\"]+)"/g)].map(match => match[1]).filter(name => !name.startsWith("__just_bash_")));
assert.deepEqual(baselineKernel, setup.current.baseline.kernel);
const baselineUnion = ordered([...baselineRegistered, ...baselineKernel]);
const baselineOnly = baselineUnion.filter(name => !oursUnion.includes(name));
assert.deepEqual(baselineOnly, setup.exactDefaultUnmeasuredNames);
const baselineClassifier = [...bundle.matchAll(/new Set\(\[([^\]]{1,20000})\]\)/g)].find(match => match[1].includes('"cd"') && match[1].includes('"eval"'));
assert.ok(baselineClassifier, "Pinned classifier extraction requires review");
const baselineClassified = ordered(JSON.parse(`[${baselineClassifier[1]}]`));
assert.deepEqual(baselineClassified, setup.current.baseline.classified);
const classifierOnly = baselineClassified.filter(name => !baselineUnion.includes(name));
assert.ok(dispatcher.includes('if(t==="wait")return ne;'));
assert.ok(bundle.includes("expand_aliases:!1"));
assert.equal(registry.find(entry => entry.name === "node")?.exported, "nodeStubCommand");

const requires = createRequire(resolve(`${baselineRoot}/dist/bundle/chunks/sqlite3-worker.js`));
const rootRequire = createRequire(resolve("package.json"));
const resolution = [];
for (const specifier of ["sql.js", "sql.js/dist/sql-wasm.wasm", "quickjs-emscripten", "turndown", "../../../vendor/cpython-emscripten/python.cjs"]) {
  try { resolution.push({ specifier, from: `${baselineRoot}/dist/bundle/chunks/sqlite3-worker.js`, resolved: file(requires.resolve(specifier)), loaded: false }); }
  catch (error) { resolution.push({ specifier, error: { name: error.name, code: error.code, message: error.message }, loaded: false }); }
}
resolution.push({ specifier: "tsx", from: "package.json", resolved: file(rootRequire.resolve("tsx")), loaded: false });
const relevantPaths = ["package.json", "package-lock.json", "benchmarks/package.json", "benchmarks/package-lock.json", "node_modules/.bin/tsx", "node_modules/tsx/package.json", "src/index.ts", "src/plugins/index.ts", "src/commands/index.ts", "src/shell/runtime.ts", `${baselineRoot}/package.json`, `${baselineRoot}/README.md`, `${baselineRoot}/dist/Bash.d.ts`, `${baselineRoot}/dist/limits.d.ts`, bundlePath,
  ...["sqlite3-worker.js", "js-exec-worker.js", "worker.js"].map(name => `${baselineRoot}/dist/bundle/chunks/${name}`),
  ...["python.cjs", "python.wasm", "python313.zip"].map(name => `${baselineRoot}/vendor/cpython-emscripten/${name}`),
  ...registry.map(entry => relative(root, resolve(dirname(bundlePath), entry.import))), ...registrationEvidence.map(entry => entry.path)];
const pkg = json(`${baselineRoot}/package.json`);
assert.equal(pkg.version, "3.4.2");
const lock = json("benchmarks/package-lock.json").packages["node_modules/just-bash"];
assert.equal(lock.version, "3.4.2");
const historical = json("benchmarks/reports/expanded-20260827/baseline-only-frozen/matrix.json");
const cohorts = Object.fromEntries(ordered(declarations.cases.map(specimen => specimen.cohort)).map(name => [name, declarations.cases.filter(specimen => specimen.cohort === name).map(specimen => specimen.name)]));
const handoffs = ["setup-status.txt", "setup-result.txt", "execution-plan.txt", "execution-status.txt", "execution-result.txt", "review.ready"].map(name => {
  const path = `/tmp/safe-bash-baseline-coverage-${name}`;
  return { path, exists: existsSync(path), ...(existsSync(path) ? { sha256: hash(readFileSync(path)), text: read(path) } : {}) };
});
const output = {
  schema: "independent-static-preflight-1", capturedAt: new Date().toISOString(), cwd: root,
  workloadsExecuted: 0, constructorCalls: 0, productsImported: false, optionalAssetsLoaded: false,
  head: git(["rev-parse", "HEAD"]), dirty: git(["status", "--short"]), index: git(["diff", "--cached", "--name-status"]),
  node: { version: process.version, platform: process.platform, arch: process.arch, executable: file(process.execPath) },
  baseline: { version: pkg.version, lock, exports: pkg.exports, integrityBoundary: "Lockfile SRI recorded, not tarball reattestation. No installation or asset startup.", registry, kernel: baselineKernel, classifierOnly },
  ours: { registrationEvidence, registered: oursRegistered, kernel: oursKernel, shadowedRegistry: oursRegistered.filter(name => oursKernel.includes(name)), union: oursUnion, method: "Static concrete factory/dispatcher inspection; no constructor or command invocation" },
  census: { historical: historical.totals, oursDefaultRegistered: oursRegistered.length, oursDefaultUnion: oursUnion.length, baselineDefaultRegistered: baselineRegistered.length, baselineDefaultUnion: baselineUnion.length, currentBaselineOnly: baselineOnly, currentBaselineOnlyCount: baselineOnly.length, additionalOptional: ["js-exec", "node", "python", "python3"], historicalNowOverlap: historical.rows.filter(row => oursUnion.includes(row.name)).map(row => row.name), missingNamesInDeclaration: baselineOnly.filter(name => !declarations.cases.some(specimen => specimen.name === name)), unexpectedHistoricalNames: cohorts["historical-unmeasured"].filter(name => !baselineOnly.includes(name)), declaredRecipes: validation.recipes, uniqueDeclaredNames: ordered(declarations.cases.map(specimen => specimen.name)).length, cohorts },
  classificationLimits: { operationalMeasurements: 0, unavailableMeasured: 0, unmeasured: declarations.cases.length, documentationOnly: ["help"], explicitNoOp: ["wait"], diagnosticRuntimeStub: ["node"], fixedVirtualIdentity: ["hostname", "whoami"], aliasSpellings: [["egrep", "grep -E"], ["fgrep", "grep -F"], ["typeset", "declare"], ["readarray", "mapfile"], ["python", "python3"]], caveat: "Alias spelling census is not distinct independent implementation count. Missing names are not missing equivalent capabilities; no functional result is inferred." },
  declarations: { input: caseFileBefore, inventory: inventoryFileBefore, cases: declarations.cases, environment: declarations.environment, budgets: declarations.budgets, networkFixture: declarations.networkFixture },
  sourceAndDependencyTrees: [tree("src"), tree("node_modules"), tree("benchmarks/node_modules")],
  files: ordered(relevantPaths).map(file), resolution, handoffs,
  blockers: ["Root review release and closed main-executor result required", "No frozen author source/input/config/loader snapshot yet supplied", "Static paths describe live preflight only, not the final measured process", "Native references have not been launched; no native oracle validity claim", "Raw results, fixture effects, exceptions and timeout classifications remain unmeasured"],
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
