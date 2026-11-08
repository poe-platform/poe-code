import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const stressRoot = dirname(directory.slice(0, -1));
const repository = dirname(dirname(dirname(stressRoot)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (name) => JSON.parse(await readFile(join(directory, name), "utf8"));
const seal = await readJson("seal.json");
const recipes = await readJson("recipes.json");
const schedules = await readJson("safety-schedules.json");
const native = await readJson("native-observations.json");
const expected = await readJson("expectations.json");
const provenance = await readJson("provenance.json");
const entries = await readdir(directory, { withFileTypes: true });
assert(entries.every((entry) => entry.isFile()), "Only sealed regular files allowed");
assert.deepEqual(entries.map((entry) => entry.name).sort(), [...seal.files.map((entry) => entry.path), "seal.json"].sort());
for (const entry of seal.files) {
  assert(!entry.path.includes("/") && entry.path !== "seal.json");
  const bytes = await readFile(join(directory, entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(hash(bytes), entry.sha256, entry.path);
}
const oldEntries = [];
async function inspectHistoricalTree(current) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    if (absolute === directory.slice(0, -1)) continue;
    if (entry.isDirectory()) await inspectHistoricalTree(absolute);
    else {
      assert(entry.isFile(), `Unexpected historical non-file: ${absolute}`);
      oldEntries.push({ path: relative(repository, absolute), sha256: hash(await readFile(absolute)) });
    }
  }
}
await inspectHistoricalTree(stressRoot);
oldEntries.sort((left, right) => left.path.localeCompare(right.path));
assert.deepEqual(oldEntries, provenance.historicalInventory, "Historical changes/additions/removals forbidden");
assert.equal(hash(await readFile(join(stressRoot, "handoff-20260827/MANIFEST.json"))), "f880ebacd7f239acad879df2a5beb92e43853e508d4d5151ef8a6448ab3df37d");
assert.equal(native.recipeSha256, hash(await readFile(join(directory, "recipes.json"))));
assert.equal(expected.recipeSha256, native.recipeSha256);
assert.equal(expected.nativeSha256, hash(await readFile(join(directory, "native-observations.json"))));
assert.equal(provenance.native.rawObservationsSha256, expected.nativeSha256);
assert.equal(native.captureScriptSha256, "01f1cd28e16b61eda0b1dbc74d25aca64ed74b975c25835701cd2b033326f264");
assert.equal(provenance.native.wrapperSha256, hash(await readFile(join(directory, "capture.mjs"))));
assert.equal(recipes.nativeRecipes.length, 17);
assert.equal(schedules.schedules.length, 16);
assert.equal(expected.rows.length, 17);
assert.equal(native.observations.length, 34);
assert.equal(native.counts.identityInvocations, 10);
assert.equal(native.counts.candidateInvocations, 0);
assert.equal(expected.candidateExecutionsThisPreparation, 0);
assert.equal(new Set(recipes.nativeRecipes.map((row) => row.id)).size, 17);
assert.equal(new Set(schedules.schedules.map((row) => row.id)).size, 16);
assert(schedules.schedules.every((row) => typeof row.negativeControl === "string" && row.negativeControl.length > 20));
for (const recipe of recipes.nativeRecipes) {
  assert.equal(recipe.variants.length, 1);
  const variant = recipe.variants[0];
  assert(Buffer.byteLength(variant.stdinUtf8) <= recipes.limits.maxInputBytesPerInvocation);
  const expectation = expected.rows.find((row) => row.id === recipe.id);
  assert.deepEqual(expectation.argv, variant.argv);
  assert.equal(expectation.stdinHex, Buffer.from(variant.stdinUtf8).toString("hex"));
  for (const profile of native.profiles) {
    const records = native.observations.filter((row) => row.recipe === recipe.id && row.profile === profile.name);
    assert.equal(records.length, 1);
    const record = records[0];
    assert.equal(record.variant, variant.name);
    assert.deepEqual(record.argv, variant.argv);
    assert.equal(record.stdinHex, expectation.stdinHex);
    if (profile.name === "util-linux-2.41.2-darwin") {
      for (const key of ["status", "stdoutHex", "stderrHex"]) assert.equal(record[key], expectation[key]);
      assert.equal(record.status, 0);
      assert.equal(record.stderrHex, "");
    }
  }
}
const probes = native.profiles.flatMap((profile) => [profile.versionProbe, profile.shortVersionProbe, profile.fileIdentity, profile.linkedLibraries]);
probes.push(native.host.uname, native.host.swVers);
for (const record of [...native.observations, ...probes]) {
  assert.equal(record.signal, null);
  assert.equal(record.termination, null);
  assert.equal(record.spawnError, null);
  assert.equal(record.stdinError, null);
  assert.equal(record.cleanup, "close-observed-process-group-retired");
  for (const stream of ["stdout", "stderr"]) {
    assert.equal(Buffer.from(record[`${stream}Hex`], "hex").length, record.observedBytes[stream]);
    assert(record.observedBytes[stream] <= recipes.limits.maxNativeOutputBytesPerStream);
  }
}
for (const profile of native.profiles) {
  const records = native.observations.filter((row) => row.profile === profile.name);
  assert.equal(records.filter((row) => row.status === 0).length, provenance.native.rawStatusPartitions[profile.name].zero);
  assert.equal(records.filter((row) => row.status !== 0).length, provenance.native.rawStatusPartitions[profile.name].nonzero);
}
const originalRecipes = JSON.parse(await readFile(join(stressRoot, "recipes.json")));
const originalNative = JSON.parse(await readFile(join(stressRoot, "native-observations.json")));
for (const recipe of recipes.nativeRecipes.filter((row) => row.original)) {
  const [originalId, variant] = recipe.original.split("/");
  const originalRecipe = originalRecipes.nativeRecipes.find((row) => row.id === originalId);
  assert.deepEqual(recipe.variants[0], originalRecipe.variants.find((row) => row.name === variant));
  const original = originalNative.observations.find((row) => row.recipe === originalId && row.variant === variant && row.profile === "util-linux-2.41.2-darwin");
  const current = expected.rows.find((row) => row.id === recipe.id);
  for (const key of ["argv", "stdinHex", "status", "stdoutHex", "stderrHex"]) assert.deepEqual(current[key], original[key]);
}
assert.deepEqual(Object.values(expected.bsdPartition).flat().sort(), recipes.nativeRecipes.map((row) => row.id).sort());
for (const recipeId of expected.bsdPartition.exactCommonFill) {
  const bsd = native.observations.find((row) => row.recipe === recipeId && row.profile === "bsd-darwin");
  const util = expected.rows.find((row) => row.id === recipeId);
  for (const key of ["status", "stdoutHex", "stderrHex"]) assert.equal(bsd[key], util[key]);
}
const findSchedule = (id) => schedules.schedules.find((row) => row.id === id);
for (const [id, bytes] of [["E01", 40], ["E05", 6], ["E06", 8], ["E07", 19]]) {
  assert.equal(Buffer.byteLength(findSchedule(id).expectedStdoutUtf8), bytes);
}
assert.equal(Buffer.from(findSchedule("E01").expectedStdoutUtf8).toString("hex"), expected.rows[0].stdoutHex);
assert.equal(findSchedule("E16").argv.reduce((sum, value) => sum + Buffer.byteLength(value), 0), 10);
assert.equal(Buffer.byteLength(findSchedule("E09").stdinUtf8), 8);
assert.equal(32768 + 2 + 1 + 1 + 1 + 32767 + 2 + 1, 65543);
assert.equal(20000 * 1024, findSchedule("E03").math.rectangularSlotsForbidden);
assert.equal(20000 * (1 + 1023 * 2 + 1), findSchedule("E03").math.successfulOutputBytes);
assert.equal(1024 + 19999, findSchedule("E03").math.actualCells);
const inputHash = createHash("sha256").update("x" + ":".repeat(1023) + "\n");
for (let index = 0; index < 19999; index++) inputHash.update("x\n");
assert.equal(inputHash.digest("hex"), expected.streamReferences.E03_E04_input.sha256);
assert.equal(1025 + 19999 * 2, expected.streamReferences.E03_E04_input.bytes);
const outputHash = createHash("sha256");
for (let index = 0; index < 20000; index++) outputHash.update("x\n");
assert.equal(outputHash.digest("hex"), expected.streamReferences.E04_success.sha256);
assert.equal(20000 * 2, expected.streamReferences.E04_success.bytes);
assert.notEqual(Buffer.from("z      9\nalpha  1   tail\nb      22\n").toString("hex"), expected.rows[0].stdoutHex);
assert.notEqual(Buffer.from("a  b  c\nd     e  \n").toString("hex"), expected.rows[1].stdoutHex);
process.stdout.write(JSON.stringify({ preparationIntegrity: "PASS", decision: "STOP_PENDING_AUTHOR_HANDOFF", literalControls: 17, nativeCaptures: 34, identityProbes: 10, safetySchedulesPreparedOnly: 16, productRuns: 0, historicalFilesUnchanged: oldEntries.length, unexpectedEntryDetection: "new scope and historical stress tree", runtimeAcceptance: "NOT_RUN" }, null, 2) + "\n");
