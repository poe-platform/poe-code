import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createGrepAliasCommands } from "../../../src/commands/grep-aliases/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { nativeCases } from "./native-cases.js";
import { digest, type NativeProfile } from "./native-support.js";
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
