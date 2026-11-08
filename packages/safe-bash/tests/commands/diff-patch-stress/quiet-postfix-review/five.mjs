import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { differences, environment, inventory, location, readJson, save, sha, status } from "./common.mjs";

const work = readFileSync(location, "utf8").trim(), manifest = readJson(join(work, "manifest.json"));
const { snapshot, oldProfile } = manifest;
const ids = ["command/patch/apply", "command/patch/dry-run", "command/patch/reverse", "command/stat/timestamp", "composition/patch-hash/patch-hash"];
const profiles = [
  { name: "corrected-current", root: snapshot, commit: manifest.commits.d1b10a3, gold: "native-scratch-aligned/native.json" },
  { name: "original-current-replay", root: oldProfile, commit: manifest.commits["0294afb"], gold: "native-corrected/native.json" },
];
const results = [];
for (const profile of profiles) {
  const helpers = join(profile.root, "benchmarks/expanded");
  const { recipes } = await import(pathToFileURL(join(helpers, "recipes.mjs")).href);
  const { compare, environment: profileEnv } = await import(pathToFileURL(join(helpers, "common.mjs")).href);
  const { observeNative, executeNative } = await import(pathToFileURL(join(helpers, "native.mjs")).href);
  const goldPath = join(snapshot, "benchmarks/reports/expanded-20260827", profile.gold);
  const gold = readJson(goldPath), workspace = join(work, `${profile.name}-native`), bin = join(workspace, "bin");
  mkdirSync(bin, { recursive: true });
  const tools = {};
  for (const name of ["bash", "patch", "stat", "sha256sum"]) {
    const expected = gold.toolIdentities[name];
    assert.equal(sha(readFileSync(expected.executable)), expected.sha256, name);
    symlinkSync(expected.executable, join(bin, name));
    const observed = await executeNative(expected.executable, ["--version"], { cwd: workspace, env: { PATH: bin, LC_ALL: "C", TZ: "UTC" }, argv0: name });
    assert.equal(observed.stdout.toString().slice(0, 512), expected.versionStdout);
    assert.equal(observed.stderr.toString().slice(0, 512), expected.versionStderr);
    assert.equal(observed.exitCode, expected.versionExit);
    assert.equal(observed.signal, null);
    assert.equal(observed.reason, undefined);
    tools[name] = { ...expected, observed: { ...observed, stdout: observed.stdout.toString("base64"), stderr: observed.stderr.toString("base64") } };
  }
  const execArgv = ["--expose-gc", "--unhandled-rejections=strict", "--import", "tsx", "--max-old-space-size=256"];
  const env = { ...environment(work), EXPANDED_ENGINE: "virtual-bash", EXPANDED_SOURCE_ROOT: snapshot };
  const child = fork(join(helpers, "engine.mjs"), [], { cwd: snapshot, execArgv, env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const exited = once(child, "exit");
  let stdout = "", stderr = "", closure;
  child.stdout.on("data", bytes => { stdout += bytes; });
  child.stderr.on("data", bytes => { stderr += bytes; });
  const rows = [];
  try {
    const [ready] = await once(child, "message");
    assert.equal(ready.ready, true, ready.error);
    for (const [index, id] of ids.entries()) {
      const specimen = recipes().find(row => row.id === id), expected = gold.observations.find(row => row.id === id);
      assert(specimen && expected?.oracleValid);
      assert.deepEqual(specimen, gold.recipes.find(row => row.id === id));
      assert.equal(sha(JSON.stringify(specimen)), expected.recipeHash);
      const waiting = once(child, "message");
      child.send({ id: index + 1, specimen, instrument: true, warmup: 0 });
      const [product] = await waiting;
      assert(product.observation, product.error);
      const native = await observeNative({ workspace, bin, bash: tools.bash.executable }, specimen);
      assert.equal(native.signal, null);
      assert.equal(native.reason, null);
      assert.equal(native.oracleValid, true);
      const frozenNativeComparison = compare(expected, native), comparison = compare(native, product.observation);
      const row = { id, specimen, recipeSha256: sha(JSON.stringify(specimen)), expected, native, product, frozenNativeComparison, comparison, namespaceDifferences: differences(native.entries, product.observation.entries) };
      rows.push(row);
      save(join(work, `${profile.name}-five-partial.json`), rows);
      if (!frozenNativeComparison.pass || (profile.name === "corrected-current" && !comparison.pass)) status(`MEANINGFUL FAILURE in ${profile.name}: ${id}. Retained ${work}/${profile.name}-five-partial.json. No changes made.`);
      console.log(JSON.stringify({ profile: profile.name, id, exact: comparison.pass, frozenNativeExact: frozenNativeComparison.pass, namespaceDifferences: row.namespaceDifferences }));
    }
  } finally {
    child.disconnect();
    const [code, signal] = await exited;
    closure = { code, signal, method: "IPC disconnect; natural exit; no signals" };
    assert.equal(code, 0);
    assert.equal(signal, null);
  }
  for (const [name, identity] of Object.entries(tools)) assert.equal(sha(readFileSync(identity.executable)), identity.sha256, name);
  assert.deepEqual(readdirSync(workspace), ["bin"], "native case and scratch directories cleaned by unchanged helper");
  const result = { profile, environment: profileEnv, goldenSha256: sha(readFileSync(goldPath)), tools, rows, closure, workerCommand: [process.execPath, ...execArgv, join(helpers, "engine.mjs")], workerCwd: snapshot, sourceRoot: snapshot, stdout, stderr, totals: { rows: rows.length, exact: rows.filter(row => row.comparison.pass).length, nativeFrozenExact: rows.filter(row => row.frozenNativeComparison.pass).length, streamsStatus: rows.filter(row => row.comparison.assertions.filter(item => item.field !== "entries").every(item => item.pass)).length } };
  results.push(result);
  save(join(work, `${profile.name}-five.json`), result);
}
const delta = results[0].rows.map(corrected => {
  const original = results[1].rows.find(row => row.id === corrected.id);
  assert.deepEqual(corrected.specimen, original.specimen);
  const changed = (before, after) => ["stdout", "stderr", "exitCode", "entries"].filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
  return { id: corrected.id, nativeFieldsChanged: changed(original.native, corrected.native), productFieldsChanged: changed(original.product.observation, corrected.product.observation), nativeNamespaceDelta: differences(original.native.entries, corrected.native.entries) };
});
assert.deepEqual(inventory(snapshot, Object.keys(manifest.inputs)), manifest.inputs);
assert.deepEqual(inventory(snapshot, ["node_modules"]), manifest.dependencies);
save(join(work, "five-summary.json"), { results: results.map(result => ({ name: result.profile.name, ...result.totals, closure: result.closure })), delta, unchangedSnapshot: true, unchangedDependencies: true, oldHistoricalFive: "4/5 retained unchanged; original-current-replay is a separate new run", eighteen: "frozen eighteen failures remain historical, not rerun or corrected" });
status(`Corrected CURRENT five: ${results[0].totals.exact}/5; separate original-profile CURRENT replay: ${results[1].totals.exact}/5. Both native recaptures match all five frozen rows. Source snapshot unchanged. Full revised3758 still pending.`);
