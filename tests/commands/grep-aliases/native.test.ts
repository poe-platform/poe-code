import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createGrepAliasCommands } from "../../../src/commands/grep-aliases/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { nativeCases } from "./native-cases.js";
import { captureProfile, digest, type NativeProfile } from "./native-support.js";
import { run } from "./helpers.js";
import { productProfile } from "./profile.js";

const frozen = JSON.parse(await readFile(new URL("./native-bsd.json", import.meta.url), "utf8")) as NativeProfile;
assert.equal(frozen.corpusSha256, digest(await readFile(new URL("./native-cases.ts", import.meta.url))));
assert.deepEqual(frozen.observations.map(observation => observation.id), nativeCases.map(fixture => fixture.id));

for (const fixture of nativeCases) test(`native-derived ${fixture.id}${productProfile(fixture).qualification ? " (qualified)" : " (exact BSD tuple)"}`, async () => {
  const fs = new MemoryFileSystem();
  for (const [name, content] of Object.entries(fixture.files)) await fs.writeFile(`/${name}`, Buffer.from(content));
  const definition = createGrepAliasCommands().find(command => command.name === fixture.alias)!;
  const result = await run(definition, fixture.args, fixture.stdin, { fs });
  const actual = { code: result.code, stdoutBase64: result.stdout.toString("base64"), stderrBase64: result.stderr.toString("base64") };
  const profile = productProfile(fixture);
  if (profile.product) {
    assert.ok(profile.qualification);
    assert.deepEqual(actual, { code: profile.product.code, stdoutBase64: Buffer.from(profile.product.stdout).toString("base64"), stderrBase64: Buffer.from(profile.product.stderr).toString("base64") });
  } else assert.deepEqual(actual, frozen.observations.find(observation => observation.id === fixture.id)!.result);
});

test("optional GNU replay requires supplied frozen identities and raw warning evidence", {
  skip: process.env.GREP_ALIASES_GNU_NATIVE !== "1" ? "GNU grep unavailable to author; supply a pinned capture and set GREP_ALIASES_GNU_NATIVE=1" : false,
}, async () => {
  const path = process.env.GREP_ALIASES_GNU_EVIDENCE;
  assert.ok(path, "GREP_ALIASES_GNU_EVIDENCE must name an independently captured GNU profile");
  const gnu = JSON.parse(await readFile(path, "utf8")) as NativeProfile;
  assert.equal(gnu.profile, "gnu");
  assert.equal(gnu.corpusSha256, frozen.corpusSha256);
  for (const identity of Object.values(gnu.identities)) assert.equal(digest(await readFile(identity.path)), identity.sha256);
  const bin = gnu.identities.grep!.path.slice(0, gnu.identities.grep!.path.lastIndexOf("/"));
  const replay = await captureProfile("gnu", bin);
  assert.equal(replay.platform, gnu.platform);
  assert.equal(replay.architecture, gnu.architecture);
  assert.deepEqual(replay.identities, gnu.identities);
  assert.deepEqual(replay.environment, gnu.environment);
  assert.deepEqual(replay.observations, gnu.observations);
});

test("optional BSD replay requires exact recorded binaries, version and corpus", {
  skip: process.env.GREP_ALIASES_NATIVE !== "1" ? "set GREP_ALIASES_NATIVE=1 for strict pinned native replay" : false,
}, async () => {
  for (const identity of Object.values(frozen.identities)) assert.equal(digest(await readFile(identity.path)), identity.sha256);
  const replay = await captureProfile("bsd", "/usr/bin");
  assert.equal(replay.platform, frozen.platform);
  assert.equal(replay.architecture, frozen.architecture);
  assert.deepEqual(replay.identities, frozen.identities);
  assert.equal(replay.corpusSha256, frozen.corpusSha256);
  assert.deepEqual(replay.observations, frozen.observations);
});
