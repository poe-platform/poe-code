import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { recipes, defaultNames, performanceRecipes } from "./recipes.mjs";
import { compare, encode, hash, projectBytes, relativePath, snapshot } from "./common.mjs";

test("fixed corpus covers every authoritative default name three times", () => {
  const corpus = recipes();
  assert.equal(corpus.length, 224); assert.equal(new Set(corpus.map(row => row.id)).size, 224);
  assert.equal(defaultNames.length, 56);
  for (const name of defaultNames) assert.equal(corpus.filter(row => row.group === "command" && row.command === name).length, 3, name);
  assert.equal(corpus.filter(row => row.group === "network").length, 8);
  assert.equal(performanceRecipes().length, 4);
});

test("native-first observations preserve recipe hashes and intentional error exits", async () => {
  const gold = JSON.parse(await readFile(new URL("../reports/expanded-20260827/native-first/native.json", import.meta.url), "utf8"));
  assert.equal(gold.invalidCount, 0); assert.equal(gold.observations.length, 228);
  for (const row of [...recipes(), ...performanceRecipes()]) {
    const captured = gold.observations.find(observation => observation.id === row.id);
    assert.equal(captured.recipeHash, hash(JSON.stringify(row)), row.id);
    assert.equal(captured.exitCode, row.nativeExit, row.id);
  }
  assert.equal(hash(await readFile(new URL("recipes.mjs", import.meta.url))), gold.sourceHashes["recipes.mjs"]);
});

test("historical corrected native capture changes no recipe", async () => {
  const gold = JSON.parse(await readFile(new URL("../reports/expanded-20260827/native-corrected/native.json", import.meta.url), "utf8"));
  assert.equal(gold.invalidCount, 0);
  for (const row of [...recipes(), ...performanceRecipes()]) assert.equal(gold.observations.find(observation => observation.id === row.id).recipeHash, hash(JSON.stringify(row)), row.id);
});

test("aligned scratch profile preserves all recipes and changes exactly one native effect", async () => {
  const current = JSON.parse(await readFile(new URL("../reports/expanded-20260827/native-scratch-aligned/native.json", import.meta.url), "utf8"));
  const previous = JSON.parse(await readFile(new URL("../reports/expanded-20260827/native-corrected/native.json", import.meta.url), "utf8"));
  assert.equal(current.invalidCount, 0); assert.deepEqual(current.recipes, previous.recipes); assert.deepEqual(current.performanceRecipes, previous.performanceRecipes);
  for (const [path, digest] of Object.entries(current.sourceHashes)) assert.equal(hash(await readFile(new URL(path, import.meta.url))), digest, path);
  const changed = [];
  for (const row of current.observations) {
    const old = previous.observations.find(observation => observation.id === row.id);
    for (const field of ["recipeHash", "stdout", "stderr", "exitCode"]) assert.deepEqual(row[field], old[field], `${row.id}/${field}`);
    if (JSON.stringify(row.entries) !== JSON.stringify(old.entries)) changed.push(row.id);
  }
  assert.deepEqual(changed, ["command/patch/dry-run"]);
  const latest = current.observations.find(row => row.id === "command/patch/dry-run"), old = previous.observations.find(row => row.id === latest.id);
  const { tmp, ...entries } = old.entries;
  assert.deepEqual(tmp, { type: "directory" }); assert.deepEqual(latest.entries, entries);
});

test("path projection leaves non-text bytes untouched", () => {
  const input = Buffer.concat([Buffer.from([0, 128, 255]), Buffer.from("/tmp/test/a"), Buffer.from([255])]);
  assert.deepEqual(projectBytes(input, [["/tmp/test", "/fixture"]]), Buffer.concat([Buffer.from([0, 128, 255]), Buffer.from("/fixture/a"), Buffer.from([255])]));
});

test("comparison detects each byte, status and filesystem field independently", () => {
  const expected = { stdout: encode([128, 255]), stderr: "", exitCode: 0, entries: { file: { type: "file", bytes: "eA==", mode: 384 } } };
  assert.equal(compare(expected, structuredClone(expected)).pass, true);
  for (const field of ["stdout", "stderr", "exitCode", "entries"]) {
    const mutated = { ...expected, [field]: field === "exitCode" ? 1 : field === "entries" ? {} : "AA==" };
    assert.equal(compare(expected, mutated).pass, false, field);
  }
});

test("snapshot includes empty directories and symlinks without following them", async () => {
  const entries = await snapshot({
    list: async path => path === "/fixture" ? ["link", "empty", "file"] : [],
    stat: async path => ({ type: path.endsWith("link") ? "symlink" : path.endsWith("empty") ? "directory" : "file", mode: 0o600 }),
    link: async () => "missing", read: async () => Buffer.from([0, 255]),
  }, { modes: true });
  assert.deepEqual(entries, { empty: { type: "directory", mode: 384 }, file: { type: "file", mode: 384, bytes: "AP8=" }, link: { type: "symlink", mode: 384, target: "missing" } });
});

test("fixture path guard rejects absolute and traversing inputs", () => {
  for (const path of ["", "/absolute", "../outside", "a/../b", "a//b"]) assert.throws(() => relativePath(path));
  assert.equal(relativePath("nested/file"), "nested/file");
});
