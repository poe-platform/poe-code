import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { execute, executeWithBytes, type Fixture } from "./harness.js";
import { assertNative } from "./jq-grammar-native-v3.js";

interface JoinFixture extends Fixture {
  policy?: string;
  policyStdout?: string;
  policyStatus?: number;
}
const corpus = JSON.parse(readFileSync(new URL("./join-native.json", import.meta.url), "utf8")) as { cases: JoinFixture[] };
for (const fixture of corpus.cases) test(`join native: ${fixture.id}`, async () => {
  if (fixture.id === "join-zero-arity" || fixture.id === "join-two-arity") {
    const result = await executeWithBytes(fixture.argv, fixture.input);
    assertNative(result, fixture.argv, fixture.input);
    return;
  }
  const result = await execute(fixture.argv, fixture.input);
  assert.equal(result.status, fixture.status, `${fixture.id}: ${result.stderr}`);
  assert.equal(result.stdout, fixture.stdout, fixture.id);
  if (fixture.status < 5 && fixture.status !== 3) assert.equal(result.stderr, "");
  else assert.match(result.stderr, /^jq: .{1,1000}\n$/u);
});
