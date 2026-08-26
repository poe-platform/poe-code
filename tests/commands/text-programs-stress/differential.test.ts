import assert from "node:assert/strict";
import test, { after } from "node:test";
import { cases } from "./cases.js";
import { compare } from "./model.js";
import { native } from "./native.js";
import { VirtualSession } from "./session.js";

const session = new VirtualSession();
after(async () => { await session.dispose(); assert.deepEqual(session.backgroundErrors, []); });

for (const fixture of cases) test(`independent text differential: ${fixture.name}`, async () => {
  const [oracle, actual] = await Promise.all([native(fixture), session.run({ fixture })]);
  const result = compare(fixture, oracle, actual);
  assert.equal(result.status, "pass", JSON.stringify(result));
});
