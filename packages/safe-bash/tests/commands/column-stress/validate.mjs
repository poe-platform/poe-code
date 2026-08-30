import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const recipeBytes = await readFile(join(directory, "recipes.json"));
const captureBytes = await readFile(join(directory, "capture-native.mjs"));
const corpus = JSON.parse(recipeBytes);
const evidence = JSON.parse(await readFile(join(directory, "native-observations.json"), "utf8"));
const provenance = JSON.parse(await readFile(join(directory, "provenance.json"), "utf8"));
const names = (await readdir(directory)).sort();
const expectedFiles = ["README.md", "capture-native.mjs", "handoff-plan.md", "native-observations.json", "provenance.json", "recipes.json", "validate.mjs"].sort();
assert.deepEqual(names, expectedFiles, "Preparation contains only its seven named artifacts, no tests or candidate imports");
assert.equal(corpus.schemaVersion, 1);
assert.equal(corpus.state, "prepared-only-no-candidate-observed");
assert.equal(corpus.nativeRecipes.length, 28);
assert.equal(corpus.safetyRecipes.length, 12);
assert.equal(corpus.nativeRecipes.length + corpus.safetyRecipes.length, corpus.limits.maxRecipes);
const recipes = [...corpus.nativeRecipes, ...corpus.safetyRecipes];
assert.equal(new Set(recipes.map((recipe) => recipe.id)).size, recipes.length);
assert.deepEqual(corpus.nativeRecipes.map((recipe) => recipe.id), Array.from({ length: 28 }, (_, index) => `N${String(index + 1).padStart(2, "0")}`));
assert.deepEqual(corpus.safetyRecipes.map((recipe) => recipe.id), Array.from({ length: 12 }, (_, index) => `S${index + 29}`));
const expectedVariants = new Map();
for (const recipe of corpus.nativeRecipes) {
  assert(recipe.productExpectation.length > 0 && recipe.oracleUse.length > 0);
  for (const variant of recipe.variants) {
    const key = `${recipe.id}/${variant.name}`;
    assert(!expectedVariants.has(key));
    assert(Array.isArray(variant.argv) && variant.argv.every((argument) => typeof argument === "string"));
    assert.notEqual(Object.hasOwn(variant, "stdinHex"), Object.hasOwn(variant, "stdinUtf8"));
    if (Object.hasOwn(variant, "stdinHex")) assert(/^(?:[0-9a-f]{2})*$/u.test(variant.stdinHex));
    const stdin = Object.hasOwn(variant, "stdinHex") ? Buffer.from(variant.stdinHex, "hex") : Buffer.from(variant.stdinUtf8);
    const files = Object.entries(variant.files ?? {}).map(([name, value]) => ({ name, hex: Buffer.from(value).toString("hex") }));
    assert(stdin.length + files.reduce((total, file) => total + file.hex.length / 2, 0) <= corpus.limits.maxInputBytesPerInvocation);
    expectedVariants.set(key, { recipe, variant, stdin, files });
  }
}
assert.equal(expectedVariants.size, 44);
assert(expectedVariants.size <= corpus.limits.maxNativeInvocationsPerProfile);
for (const recipe of corpus.safetyRecipes) {
  assert(recipe.basis.length > 0 && recipe.assertions.length > 0);
  assert(recipe.variants?.length || recipe.schedule?.length);
}
assert.equal(evidence.classification, "raw-native-observations-not-product-results");
assert.equal(evidence.recipeSha256, digest(recipeBytes));
assert.equal(evidence.captureScriptSha256, digest(captureBytes));
assert.deepEqual(evidence.limits, corpus.limits);
assert.equal(evidence.counts.candidateInvocations, 0);
assert.equal(evidence.counts.safetyRecipesPreparedOnly, 12);
assert.equal(evidence.counts.variantsPerProfile, expectedVariants.size);
assert.equal(evidence.counts.nativeInvocations, expectedVariants.size * evidence.profiles.length);
assert.equal(evidence.observations.length, evidence.counts.nativeInvocations);
assert.equal(evidence.counts.identityInvocations, evidence.profiles.length * 4 + 2);
assert.equal(evidence.cleanup.invocationDirectoriesRemoved, true);
assert.equal(evidence.cleanup.ownedNativeProcessesRetired, true);
assert.equal(evidence.environment.LC_ALL, "en_US.UTF-8");
assert.equal(evidence.environment.COLUMNS, "80");
const seen = new Set();
const profileNames = new Set(evidence.profiles.map((profile) => profile.name));
assert.equal(profileNames.size, evidence.profiles.length);
const summary = {};
function checkResult(result) {
  for (const name of ["stdout", "stderr"]) {
    const hex = result[`${name}Hex`];
    assert(/^(?:[0-9a-f]{2})*$/u.test(hex), "Raw bytes must be canonical hex");
    assert(hex.length / 2 <= corpus.limits.maxNativeOutputBytesPerStream);
    if (result.termination === null) assert.equal(hex.length / 2, result.observedBytes[name]);
  }
  assert(result.status === null || (Number.isInteger(result.status) && result.status >= 0 && result.status <= 255));
  assert(result.signal === null || typeof result.signal === "string");
  assert.equal(result.cleanup, "close-observed-process-group-retired");
  assert.equal(result.deadlineMs, corpus.limits.nativeDeadlineMs);
  assert.equal(result.termination, null, "Harness termination is not a completed native fixture");
  assert.equal(result.spawnError, null, "Spawn failure is not an available native oracle");
}
for (const profile of evidence.profiles) {
  assert(/^[0-9a-f]{64}$/u.test(profile.sha256));
  for (const field of ["versionProbe", "shortVersionProbe", "fileIdentity", "linkedLibraries"]) checkResult(profile[field]);
  summary[profile.name] = { statusZero: 0, statusNonzero: 0, signals: 0 };
}
for (const observation of evidence.observations) {
  assert(profileNames.has(observation.profile));
  const variantKey = `${observation.recipe}/${observation.variant}`;
  const key = `${observation.profile}/${variantKey}`;
  assert(!seen.has(key));
  seen.add(key);
  const expected = expectedVariants.get(variantKey);
  assert(expected, key);
  assert.deepEqual(observation.argv, expected.variant.argv);
  assert.equal(observation.stdinHex, expected.stdin.toString("hex"));
  assert.deepEqual(observation.files, expected.files);
  assert.equal(observation.oracleUse, expected.recipe.oracleUse);
  checkResult(observation);
  if (observation.signal) summary[observation.profile].signals += 1;
  else if (observation.status === 0) summary[observation.profile].statusZero += 1;
  else summary[observation.profile].statusNonzero += 1;
}
for (const profile of profileNames) for (const variant of expectedVariants.keys()) assert(seen.has(`${profile}/${variant}`));
for (const result of Object.values(evidence.host)) checkResult(result);
assert.equal(provenance.candidateObserved, false);
assert.equal(provenance.productRuns, 0);
assert.equal(provenance.stopAfterPreparation, true);
assert.equal(provenance.sourceInputs.some((input) => input.path.startsWith("src/commands/column/")), false);
assert.equal(provenance.sourceInputs.some((input) => input.path.startsWith("tests/commands/column/")), false);
assert.deepEqual(provenance.ownedArtifacts.map((entry) => entry.path).sort(), expectedFiles.filter((name) => name !== "provenance.json"));
for (const artifact of provenance.ownedArtifacts) {
  const bytes = await readFile(join(directory, artifact.path));
  assert.equal(digest(bytes), artifact.sha256, `Frozen artifact hash mismatch: ${artifact.path}`);
  assert.equal(bytes.length, artifact.bytes);
}
for (const name of ["capture-native.mjs", "validate.mjs"]) {
  const source = await readFile(join(directory, name), "utf8");
  const imports = [...source.matchAll(/^import .* from "([^"]+)";/gmu)].map((match) => match[1]);
  assert(imports.length >= 4 && imports.every((specifier) => specifier.startsWith("node:")));
  assert(!/\bimport\s*\(|\brequire\s*\(/u.test(source), "No dynamic candidate/dependency loading in preparation helpers");
}
console.log(JSON.stringify({ staticValidation: "passed", recipes: recipes.length, nativeVariantsPerProfile: expectedVariants.size, nativeInvocations: seen.size, nativeStatusesNotCandidatePasses: summary, safetyRecipesPreparedNotExecuted: 12, productRuns: 0, stopAfterPreparation: true }, null, 2));
