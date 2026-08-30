import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { globSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const owned = "tests/plugins/qualified-current-release-native-data";
const native = "tests/commands/regex-execution/continuation/artifacts/native";
const protectedPrefix = "tests/integration/qualified-current-release-review/";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const hashFile = path => digest(readFileSync(resolve(root, path)));
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const run = (command, args) => {
  const started = new Date().toISOString();
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  return { command, args, started, ended: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
};
const hashes = paths => Object.fromEntries([...new Set(paths)].sort().filter(path => !path.startsWith(protectedPrefix)).map(path => [path, hashFile(path)]));

function classifyNative() {
  const cases = JSON.parse(readFileSync(resolve(root, "tests/commands/regex-execution/continuation/dialect-evidence.json"), "utf8")).cases;
  const groups = new Map();
  const files = [];
  function walk(directory) {
    for (const name of readdirSync(resolve(root, directory)).sort()) {
      const path = `${directory}/${name}`;
      const stat = lstatSync(resolve(root, path));
      assert.equal(stat.isSymbolicLink(), false, `Unexpected symlink: ${path}`);
      if (stat.isDirectory()) { walk(path); continue; }
      assert.ok(stat.isFile(), `Unexpected entry: ${path}`);
      const within = path.slice(native.length + 1);
      const [group, ...segments] = within.split("/");
      const bytes = readFileSync(resolve(root, path));
      const entry = { path, bytes: bytes.length, sha256: digest(bytes) };
      if (group.startsWith("dialect-")) {
        assert.equal(bytes.toString(), "hit\n", `Unexpected dialect payload: ${path}`);
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(segments.join("/"));
        Object.assign(entry, { classification: "raw-native-glob-payload", payloadUtf8: "hit\n" });
      } else {
        assert.match(group, /^tsx-\d+$/u);
        const cache = JSON.parse(bytes.toString());
        assert.deepEqual(Object.keys(cache).sort(), ["code", "map", "warnings"]);
        assert.equal(typeof cache.code, "string");
        assert.ok(Array.isArray(cache.map.sources));
        assert.ok(cache.map.sources.every(path => path.startsWith(root) && !relative(root, path).startsWith(protectedPrefix)));
        Object.assign(entry, { classification: "generated-tsx-transform-cache-not-authored-source", sources: cache.map.sources.map(path => relative(root, path)) });
      }
      files.push(entry);
    }
  }
  walk(native);
  const dialectGroups = [...groups].map(([directory, paths]) => {
    const fixture = cases.find(item => JSON.stringify([...item.files].sort()) === JSON.stringify(paths.sort()));
    assert.ok(fixture, `No producer case for ${directory}`);
    return { directory, producerCase: fixture.name, glob: fixture.glob, files: paths };
  });
  assert.equal(dialectGroups.length, cases.length);
  const rawTypeScript = files.filter(entry => entry.classification === "raw-native-glob-payload" && entry.path.endsWith(".ts"));
  assert.equal(rawTypeScript.length, 6);
  for (const entry of rawTypeScript) assert.equal(entry.sha256, "74a02f560cc1d8e023280b5f08a1ee7266e4bec6cea61ca457dc1a758d080fc8");
  return { producer: "tests/commands/regex-execution/continuation/dialect.mjs", producerSha256: hashFile("tests/commands/regex-execution/continuation/dialect.mjs"), producerEvidenceSha256: hashFile("tests/commands/regex-execution/continuation/dialect-evidence.json"), profileSha256: hashFile("tests/commands/regex-execution/continuation/dialect-profile.json"), userClassification: "The six TS2304 hit files are immutable raw native glob test data, not code.", classificationBasis: "All dialect directory filename sets match the ten recorded producer cases and every payload is exactly hit plus LF. All other files are JSON tsx transformation caches with code/warnings/map and external canonical source-map paths; generated copies, not maintained tests/helpers. No unknown entry or symlink is accepted.", counts: { files: files.length, dialectGroups: dialectGroups.length, rawPayloads: files.filter(entry => entry.classification === "raw-native-glob-payload").length, rawTypeScript: rawTypeScript.length, generatedCaches: files.filter(entry => entry.classification === "generated-tsx-transform-cache-not-authored-source").length, maintainedSourcesOrHelpers: 0 }, dialectGroups, files };
}

function snapshot() {
  const listFiles = run(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--listFilesOnly", "--pretty", "false"]);
  assert.equal(listFiles.status, 0, listFiles.stdout + listFiles.stderr);
  const programFiles = listFiles.stdout.trim().split("\n").map(path => relative(root, path)).sort();
  const sourceFiles = programFiles.filter(path => path.startsWith("src/"));
  const testFiles = programFiles.filter(path => path.startsWith("tests/"));
  const canonicalTests = globSync("tests/**/*.test.ts", { cwd: root }).sort();
  const trackedTests = git("ls-files", "-z", "tests").split("\0").filter(path => path.endsWith(".test.ts")).sort();
  const filteredTests = globSync("tests/**/*.test.ts", { cwd: root, exclude: path => path === native }).sort();
  const sourcePaths = git("ls-files", "src").split("\n");
  const testPaths = testFiles.filter(path => !path.startsWith(`${native}/`));
  const configPaths = ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"];
  const sourceHashes = hashes(sourcePaths);
  const testHashes = hashes(testPaths);
  const configurationHashes = hashes(configPaths);
  const nativeData = classifyNative();
  const included = new Set(programFiles);
  const perPathControls = ["src/index.ts", "src/shell/shell.ts", "src/commands/search/glob.ts", "tests/commands/helpers.ts", "tests/commands/search/helpers.ts", "tests/shell/helpers.ts", "tests/commands/regex-execution/continuation/glob.test.ts", "tests/commands/regex-execution/continuation/glob-transport.test.ts", "tests/contracts/command.test.ts"].map(path => ({ path, included: included.has(path), sha256: hashFile(path) }));
  assert.ok(perPathControls.every(control => control.included));
  assert.ok(canonicalTests.every(path => included.has(path)));
  return {
    time: new Date().toISOString(),
    head: git("rev-parse", "HEAD"),
    committedSourceTree: git("rev-parse", "HEAD:src"),
    committedTestTree: git("rev-parse", "HEAD:tests"),
    status: git("status", "--short"),
    staged: git("diff", "--cached", "--name-status"),
    indexSha256: hashFile(git("rev-parse", "--git-path", "index")),
    config: JSON.parse(readFileSync(resolve(root, "tsconfig.json"), "utf8")),
    testScript: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts.test,
    configurationHashes,
    sourceHashes,
    sourceManifestSha256: digest(JSON.stringify(sourceHashes)),
    testHashes,
    testManifestSha256: digest(JSON.stringify(testHashes)),
    hashLimit: "Protected reviewer contents are never opened or hashed. Canonical compiler invocation remains global; path census only and opaque committed tests tree identify the protected portion. No whole live test-byte closure is claimed.",
    counts: {
      programFiles: programFiles.length,
      sourceFiles: sourceFiles.length,
      testFiles: testFiles.length,
      canonicalTests: canonicalTests.length,
      canonicalTestsIncluded: canonicalTests.filter(path => included.has(path)).length,
      trackedCanonicalTests: trackedTests.length,
      trackedCanonicalTestsIncluded: trackedTests.filter(path => included.has(path)).length,
      filteredCanonicalTests: filteredTests.length,
      nonCanonicalTestInputs: testFiles.filter(path => !canonicalTests.includes(path)).length,
      sourceHashes: Object.keys(sourceHashes).length,
      testHashes: Object.keys(testHashes).length,
      protectedTestInputsNotHashed: testFiles.filter(path => path.startsWith(protectedPrefix)).length,
    },
    perPathControls,
    canonicalTests,
    trackedTests,
    filteredTests,
    programFiles,
    listFiles,
    nativeData,
  };
}

const label = process.argv[2];
assert.match(label ?? "", /^(before|after|committed)(-\d+)?$/u);
const before = snapshot();
const gate = run("npm", ["run", "typecheck"]);
const after = snapshot();
const stable = { head: before.head === after.head, source: JSON.stringify(before.sourceHashes) === JSON.stringify(after.sourceHashes), tests: JSON.stringify(before.testHashes) === JSON.stringify(after.testHashes), configs: JSON.stringify(before.configurationHashes) === JSON.stringify(after.configurationHashes), nativeData: JSON.stringify(before.nativeData) === JSON.stringify(after.nativeData), program: JSON.stringify(before.programFiles) === JSON.stringify(after.programFiles), index: before.indexSha256 === after.indexSha256 };
const result = { label, profile: "Current working tree; global noEmit; no product build, rootdist writes, full npm test, or independent holdout inspection", runtime: { node: process.version, platform: process.platform, arch: process.arch, npm: run("npm", ["--version"]).stdout.trim(), typescript: run(process.execPath, ["node_modules/typescript/bin/tsc", "--version"]).stdout.trim() }, before, gate, after, stable };
writeFileSync(resolve(root, owned, `${label}.json`), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ label, gateStatus: gate.status, counts: after.counts, nativeCounts: after.nativeData.counts, stable }, null, 2));
assert.ok(stable.configs && stable.nativeData);
if (label.startsWith("before")) {
  assert.equal(gate.status, 2);
  const diagnostics = gate.stdout.split("\n").filter(line => line.startsWith(native + "/") && line.includes("error TS"));
  assert.equal(diagnostics.length, 6);
  assert.ok(diagnostics.every(line => line.startsWith(native + "/") && line.endsWith("(1,1): error TS2304: Cannot find name 'hit'.")));
} else {
  assert.ok(gate.status === 0 || gate.status === 2, gate.stdout + gate.stderr);
  assert.ok(!gate.stdout.split("\n").some(line => line.startsWith(native + "/") && line.includes("error TS")));
}
