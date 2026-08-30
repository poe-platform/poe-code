import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { root, owned, execution, setup, hash, json, read, ordered, evidence, tree, publish } from "./common.mjs";

assert.equal(process.cwd(), root);
const attempt = process.argv[2] ?? `${execution}/attempt-001`;
const output = process.argv[3] ?? `${owned}/static-attempt-001.json`;
const manifest = json(`${attempt}/manifest.json`);
const inputs = json(`${attempt}/execution-inputs.json`);
const freeze = json(`${attempt}/freeze.json`);
const inventory = json(`${setup}/inventory.json`);
const checks = [];
function check(name, actual, expected) {
  const passes = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ name, passes, actual, expected });
}
check("frozen manifest bytes", hash(readFileSync(`${attempt}/manifest.json`)), freeze.manifestSha256);
check("frozen input bytes", hash(readFileSync(`${attempt}/execution-inputs.json`)), freeze.inputsSha256);
check("historical inventory retained", inventory.rows.length, 53);
check("historical measured retained", inventory.historical.totals.namesWithPrimaryRecipes, 3);
check("all current default names", ordered(inputs.cases.filter(specimen => specimen.cohort === "historical-unmeasured").map(specimen => specimen.name)), ordered(inventory.exactDefaultUnmeasuredNames));
check("all four optional names", ordered(inputs.cases.filter(specimen => specimen.cohort === "additional-optional").map(specimen => specimen.name)), ["js-exec", "node", "python", "python3"]);
check("primary count", inputs.cases.length, 61);
check("unique specimen identifiers", new Set([...inputs.cases, ...inputs.diagnostics].map(specimen => specimen.id)).size, inputs.cases.length + inputs.diagnostics.length);
for (const specimen of [...inputs.cases, ...inputs.diagnostics]) {
  const { inputSha256, ...body } = specimen;
  check(`input hash ${specimen.id}`, hash(JSON.stringify(body)), inputSha256);
  for (const relative of [...Object.keys(specimen.files), ...specimen.directories, ...Object.keys(specimen.symlinks)]) check(`contained fixture ${specimen.id}/${relative}`, !relative.startsWith("/") && !relative.split("/").some(segment => ["", ".", ".."].includes(segment)), true);
  for (const fixture of Object.values(specimen.files)) check(`canonical bytes ${specimen.id}`, Buffer.from(fixture.base64, "base64").toString("base64"), fixture.base64);
  if (specimen.cohort === "direct-diagnostic") check(`no diagnostic credit ${specimen.id}`, specimen.operationalCredit, false);
}
const sourceRoot = `${inputs.paths.snapshot}/src`;
const source = tree(sourceRoot);
check("snapshot source hash", source.sha256, manifest.snapshot.sha256);
check("same pinned source", source.sha256, "30f5cfb47f69af0aeb4460fa901904d0b70f4ca8594013f70aa308dafb379732");
const definitions = ["basic", "filesystem", "streams", "text", "grep", "execution", "find"].flatMap(name => [...read(`${sourceRoot}/commands/${name}.ts`).matchAll(/define\("([^"]+)"/g)].map(match => ({ name: match[1], path: `commands/${name}.ts` })));
definitions.push(...["head", "tail"].map(name => ({ name, path: "commands/streams.ts" })), ...["test", "["].map(name => ({ name, path: "commands/predicates.ts" })));
const families = { sed: "text-programs/sed.ts", awk: "text-programs/awk.ts", jq: "structured/jq.ts", rg: "search/rg.ts", base32: "bytes/encoding/index.ts", base64: "bytes/encoding/index.ts", xxd: "bytes/encoding/index.ts", od: "bytes/encoding/index.ts", sha256sum: "bytes/checksums/index.ts", sha1sum: "bytes/checksums/index.ts", md5sum: "bytes/checksums/index.ts", cksum: "bytes/checksums/index.ts", gzip: "bytes/compression/index.ts", gunzip: "bytes/compression/index.ts", zcat: "bytes/compression/index.ts", diff: "diff-patch/diff.ts", patch: "diff-patch/patch.ts", chmod: "metadata/chmod.ts", stat: "metadata/stat.ts", mktemp: "metadata/mktemp.ts", tar: "archive/index.ts", paste: "table-text/paste.ts", comm: "table-text/comm.ts", join: "table-text/join.ts" };
for (const [name, tail] of Object.entries(families)) {
  check(`frozen definition ${name}`, read(`${sourceRoot}/commands/${tail}`).includes(name), true);
  definitions.push({ name, path: `commands/${tail}` });
}
const oursRegistered = ordered(definitions.map(entry => entry.name));
check("frozen registry static definitions", oursRegistered, inventory.current.virtual.registered);
const runtime = read(`${sourceRoot}/shell/runtime.ts`);
const builtinNames = [...runtime.match(/const shellBuiltinNames = new Set\(\[([\s\S]*?)\]\);/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
const oursKernel = ordered(builtinNames.filter(name => !["echo", "printf", "test", "["].includes(name)));
check("frozen ours concrete kernel", oursKernel, inventory.current.virtual.kernel);
const bundle = read(inputs.paths.baselineEntry);
const registry = [...bundle.matchAll(/\{name:"([^"]+)",load:async\(\)=>\(await import\("([^"]+)"\)\)\.([\w$]+)/g)].map(match => ({ name: match[1], import: match[2], exported: match[3] }));
const baselineRegistered = ordered(registry.filter(entry => !["curl", "js-exec", "node", "python", "python3"].includes(entry.name)).map(entry => entry.name));
check("pinned baseline registry", baselineRegistered, inventory.current.baseline.registered);
const dispatchPosition = bundle.indexOf('if(t==="cd")');
const dispatcher = bundle.slice(bundle.lastIndexOf("async function ", dispatchPosition), bundle.indexOf("async function ", dispatchPosition));
const baselineKernel = ordered([...dispatcher.matchAll(/t==="([^"]+)"/g)].map(match => match[1]).filter(name => !name.startsWith("__just_bash_")));
check("pinned concrete baseline dispatch", baselineKernel, inventory.current.baseline.kernel);
const oursUnion = ordered([...oursRegistered, ...oursKernel, "bash", "sh"]);
const baselineUnion = ordered([...baselineRegistered, ...baselineKernel]);
check("exact current default difference", baselineUnion.filter(name => !oursUnion.includes(name)), inventory.exactDefaultUnmeasuredNames);
check("classifier phantom exclusions", inventory.current.baseline.classified.filter(name => !baselineUnion.includes(name)).sort(), inventory.excludedClassifierOnlyNames);
check("node remains diagnostic stub", registry.find(entry => entry.name === "node")?.exported, "nodeStubCommand");
const dependencies = manifest.dependencies.map(previous => {
  const current = tree(previous.directory);
  check(`dependency tree ${previous.directory}`, current.sha256, previous.sha256);
  return { directory: current.directory, sha256: current.sha256, files: current.entries.length, symlinks: current.entries.filter(entry => entry.type === "symlink") };
});
const assets = manifest.runtimeAssets.map(entry => {
  const current = evidence(entry.path);
  check(`runtime asset ${entry.path}`, current.sha256, entry.sha256);
  return current;
});
const baselinePackage = json("benchmarks/node_modules/just-bash/package.json");
check("installed version", baselinePackage.version, "3.4.2");
check("lock version", json("benchmarks/package-lock.json").packages["node_modules/just-bash"].version, "3.4.2");
check("node binary", evidence(inputs.paths.node).sha256, manifest.node.executable.sha256);
check("explicit optional JavaScript", inputs.configurations.baseline.javascript.javascript, true);
check("explicit optional Python", inputs.configurations.baseline.python.python, true);
const harness = manifest.harness.map(entry => ({ path: entry.path, frozenSha256: entry.sha256, ...evidence(entry.path), matches: evidence(entry.path).sha256 === entry.sha256 }));
const results = { capturedAt: new Date().toISOString(), phase: "static-only", independentEngineCalls: 0, attempt, freeze, sourceSha256: source.sha256, sourceFiles: source.entries.length, checks, passes: checks.every(entry => entry.passes), counts: { primary: inputs.cases.length, diagnostics: inputs.diagnostics.length, declaredEngineAttempts: 2 * (inputs.cases.length + inputs.diagnostics.length), oursRegistry: oursRegistered.length, oursUnion: oursUnion.length, baselineRegistry: baselineRegistered.length, baselineUnion: baselineUnion.length, defaultTargets: 50, optionalTargets: 4, excludedPhantoms: inventory.excludedClassifierOnlyNames.length }, definitions, baselineRegistry: registry, dependencies, assets, harness, snapshotPackageAndConfig: ["package.json", "tsconfig.json"].map(name => evidence(path.join(inputs.paths.snapshot, name))), childEnvironment: inputs.childEnvironment, primarySources: { accessedViaWebRun: "2026-08-27", upstreamCommit: "a021f95f53f7e01df48dab71b46ffd4637fb4b53", installedCanonical: true, documentationClaimsLimitedToOptionsAndStub: true }, limits: ["No product import, constructor, execution, native oracle, or optional worker startup in this static audit.", "Dependency trees use installed byte hashes, not tarball reattestation.", "First attempt remains invalid even if hash/schema checks pass; known IPC/network/scratch faults are not product losses.", "Hash checks do not guarantee absence of transient between-check edits or prove every worker asset file read."] };
publish(output, results);
console.log(JSON.stringify({ output, passes: results.passes, checks: checks.length, failures: checks.filter(entry => !entry.passes), counts: results.counts, harnessDrift: harness.filter(entry => !entry.matches).map(entry => entry.path) }, null, 2));
