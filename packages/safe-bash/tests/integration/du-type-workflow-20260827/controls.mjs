import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export async function classificationControls(root, directory) {
  const { verifyTypecheckInputs, classification } = await import(pathToFileURL(join(root, "scripts/typecheck-inputs.mjs")));
  const { verifyStagedTypeInputs, stagedClassificationPath } = await import(pathToFileURL(join(root, "scripts/typecheck-staged-inputs.mjs")));
  const { consumerGroups, currentConsumerPaths, currentSourceConsumerGroups } = await import(pathToFileURL(join(root, "tests/plugins/qualified-current-release/consumers.mjs")));
  const staged = JSON.parse(readFileSync(join(root, stagedClassificationPath)));
  const inventoryPath = "tests/plugins/qualified-current-release/inventory.json";
  const inventory = JSON.parse(readFileSync(join(root, inventoryPath)));
  const files = new Set(["tsconfig.json", inventoryPath, stagedClassificationPath, classification.provenance,
    ...classification.evidence.map(entry => entry.path),
    ...classification.entries.flatMap(entry => [entry.path, entry.originalPath]),
    ...staged.entries.flatMap(entry => [entry.path, entry.owner.path]),
    ...inventory.entries.flatMap(entry => [entry.path, ...entry.freeze?.evidence.map(evidence => evidence.path) ?? []]),
    ...currentConsumerPaths(), ...currentSourceConsumerGroups.flatMap(group => group.files)]);
  for (const path of files) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    copyFileSync(join(root, path), join(directory, path));
  }
  execFileSync("git", ["init", "-q", directory]);
  execFileSync("git", ["add", "--all"], { cwd: directory });
  const results = [];
  const check = (name, operation) => {
    try { operation(); results.push({ name, status: "pass" }); }
    catch (error) { results.push({ name, status: "fail", error: error.stack }); }
  };
  const change = (path, bytes, operation) => {
    const target = join(directory, path), before = readFileSync(target);
    writeFileSync(target, bytes);
    try { operation(); } finally { writeFileSync(target, before); }
  };
  const rejected = pattern => assert.throws(() => verifyTypecheckInputs(directory), pattern);
  check("positive complete classifications", () => assert.equal(verifyTypecheckInputs(directory).stagedInputs.length, 14));
  check("exact roles", () => assert.deepEqual(Object.fromEntries(["sealed-capture", "versioned-template", "reusable-template"].map(role => [role, staged.entries.filter(entry => entry.role === role).length])), { "sealed-capture": 6, "versioned-template": 5, "reusable-template": 3 }));
  for (const entry of staged.entries) {
    check(`changed bytes: ${entry.path}`, () => change(entry.path, "export {};\n", () => rejected(/staged input (?:length )?changed/u)));
    check(`missing input: ${entry.path}`, () => {
      const target = join(directory, entry.path); renameSync(target, target + ".saved");
      try { rejected(/ENOENT/u); } finally { renameSync(target + ".saved", target); }
    });
    check(`owner mutation: ${entry.path}`, () => change(entry.owner.path, "{}\n", () => rejected(/owning manifest changed/u)));
  }
  for (const [label, mutate] of [
    ["unknown role", value => { value.entries[0].role = "discardable"; }],
    ["unbound manifest input", value => { value.entries[0].owner.input = "unknown.ts"; }],
    ["wrong owning collection", value => { value.entries[0].owner.collection = "filesAny"; }],
    ["missing maintained route", value => { value.entries[0].currentGroup = "absent"; }],
    ["duplicate input", value => value.entries.push(value.entries[0])],
    ["directory wildcard", value => { value.entries[0].path = "tests/**/consumer.ts"; }],
  ]) check(label, () => {
    const next = structuredClone(staged); mutate(next);
    change(stagedClassificationPath, JSON.stringify(next), () => assert.throws(() => verifyTypecheckInputs(directory)));
  });
  for (const [label, mutate] of [
    ["unknown exclusion", value => value.exclude.push("tests/new/**")],
    ["directory-wide DU exclusion", value => value.exclude.push("tests/integration/du-overlay-independent-20260827")],
    ["current source excluded", value => value.exclude.push("src/contracts/command.ts")],
    ["missing exact staged exclusion", value => value.exclude.pop()],
    ["test include removed", value => { value.include = ["src/**/*.ts"]; }],
  ]) check(label, () => {
    const next = JSON.parse(readFileSync(join(directory, "tsconfig.json"))); mutate(next);
    change("tsconfig.json", JSON.stringify(next), () => rejected(/coverage|exclusions/u));
  });
  const consumer = "tests/plugins/qualified-current-release/du-leaf.mts";
  check("missing maintained DU consumer", () => {
    const target = join(directory, consumer); renameSync(target, target + ".saved");
    try { rejected(/ENOENT/u); } finally { renameSync(target + ".saved", target); }
  });
  check("DU route must stage local package", () => assert.throws(() => verifyStagedTypeInputs(directory, consumerGroups.map(group => group.name === "du-leaf" ? { ...group, localPackage: false } : group)), /maintained local-package runtime route/u));
  check("DU route must execute", () => assert.throws(() => verifyStagedTypeInputs(directory, consumerGroups.map(group => group.name === "du-leaf" ? { ...group, runtime: [] } : group)), /maintained local-package runtime route/u));
  check("symlink input rejected", () => {
    const target = join(directory, staged.entries[0].path); renameSync(target, target + ".saved"); symlinkSync(target + ".saved", target);
    try { rejected(/regular file/u); } finally { rmSync(target); renameSync(target + ".saved", target); }
  });
  check("unknown tracked standalone consumer rejected", () => {
    const path = "tests/plugins/qualified-current-release/unknown.mts", target = join(directory, path);
    assert.equal(existsSync(target), false); writeFileSync(target, "export {};\n"); execFileSync("git", ["add", "--", path], { cwd: directory });
    try { rejected(/Unclassified current .mts/u); }
    finally { execFileSync("git", ["rm", "--cached", "--", path], { cwd: directory }); rmSync(target); }
  });
  check("after controls original inputs intact", () => {
    assert.equal(verifyTypecheckInputs(directory).stagedInputs.length, 14);
    for (const entry of staged.entries) assert.deepEqual(readFileSync(join(directory, entry.path)), readFileSync(join(root, entry.path)));
  });
  return results;
}
