import assert from "node:assert/strict";
import test from "node:test";
import { createCommandArguments } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { nativeCases } from "./native-cases.js";
import { run } from "./support.js";

for (const fixture of nativeCases) {
  test(`native raw argv: ${fixture.name}`, async () => {
    const argumentsOwned = createCommandArguments(fixture.argsHex.map(value => shellValueFromBytes(Buffer.from(value, "hex"))));
    const result = await run(argumentsOwned.args, {}, { argumentValues: argumentsOwned, env: fixture.env });
    assert.equal(result.exitCode, fixture.status);
    assert.equal(result.stdout.toString("hex"), fixture.stdoutHex);
    assert.equal(result.stderr.toString("hex"), fixture.stderrHex);
  });
}

for (const fixture of nativeCases.filter(fixture => fixture.argsHex.every(value => {
  const bytes = Buffer.from(value, "hex");
  return Buffer.from(bytes.toString("utf8")).equals(bytes);
}))) {
  test(`native string argv: ${fixture.name}`, async () => {
    const result = await run(fixture.argsHex.map(value => Buffer.from(value, "hex").toString("utf8")), {}, { env: fixture.env });
    assert.equal(result.exitCode, fixture.status);
    assert.equal(result.stdout.toString("hex"), fixture.stdoutHex);
    assert.equal(result.stderr.toString("hex"), fixture.stderrHex);
  });
}
