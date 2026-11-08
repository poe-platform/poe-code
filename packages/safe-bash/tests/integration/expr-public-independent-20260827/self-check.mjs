import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL(name, import.meta.url));
const data = JSON.parse(read("cases.json"));
assert.equal(data.runtimeCases.length, 26);
assert.deepEqual(data.runtimeCases.map(fixture => fixture.id), Array.from({ length: 26 }, (_, index) => `R${String(index + 1).padStart(2, "0")}`));
assert.equal(data.baselineNames.length, 75);
assert.equal(new Set([...data.baselineNames, ...data.addedNames]).size, 76);
for (const name of data.excludedNames) assert.ok(!data.baselineNames.includes(name));
for (const fixture of data.runtimeCases.filter(fixture => fixture.kind === "expression" || fixture.kind === "pipeline" || fixture.kind === "startup")) {
  for (const variant of [fixture, ...(fixture.variants ?? [])]) {
    assert.ok([0, 1, 2, 3].includes(variant.exitCode));
    assert.ok(typeof variant.stdout === "string" || /^[0-9a-f]+$/u.test(variant.stdoutHex));
    assert.ok(typeof variant.stderr === "string" || variant.diagnostic === "expr-single-line");
    if (variant.args) assert.ok(variant.args.every(argument => typeof argument === "string"));
  }
}
assert.equal(data.runtimeCases.filter(fixture => fixture.binding).length, 2);
assert.equal(data.runtimeCases.reduce((count, fixture) => count + (fixture.variants?.length ?? 0), 0), 2);
assert.equal((read("negative.ts.fixture").toString().match(/@ts-expect-error N0[1-6]/gu) ?? []).length, 6);
assert.equal((read("PROTOCOL.md").toString().match(/^\| P0[1-8] \|/gmu) ?? []).length, 8);
const provenance = JSON.parse(read("provenance.json"));
for (const source of provenance.sources) {
  assert.match(source.commit, /^[0-9a-f]{40}$/u);
  assert.match(source.blob, /^[0-9a-f]{40}$/u);
  assert.match(source.sha256, /^[0-9a-f]{64}$/u);
  assert.ok(source.bytes > 0);
}
for (const [name, hash] of Object.entries(provenance.fixtureSha256)) {
  assert.equal(createHash("sha256").update(read(name)).digest("hex"), hash, name);
}
console.log(JSON.stringify({ scope: "syntax/data only; no product import", runtimeCases: 26, consumerBackedCases: 24, lifecycleBindingsPending: 2, extraInputVariants: 2, positiveTypeFiles: 1, negativeTypeDirectives: 6, packageProtocolIds: 8, productExecuted: false }));
