import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { execute, type Fixture } from "./harness.js";

interface JoinFixture extends Fixture {
  policy?: string;
  policyStdout?: string;
  policyStatus?: number;
}
const corpus = JSON.parse(readFileSync(new URL("./join-native.json", import.meta.url), "utf8")) as { cases: JoinFixture[] };
for (const fixture of corpus.cases) test(`join native: ${fixture.id}`, async () => {
  const result = await execute(fixture.argv, fixture.input);
  assert.equal(result.status, fixture.status, `${fixture.id}: ${result.stderr}`);
  assert.equal(result.stdout, fixture.stdout, fixture.id);
  if (fixture.status < 5 && fixture.status !== 3) assert.equal(result.stderr, "");
  else assert.match(result.stderr, /^jq: .{1,1000}\n$/u);
});
