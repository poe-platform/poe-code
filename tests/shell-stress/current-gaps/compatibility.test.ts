import assert from "node:assert/strict";
import { test } from "node:test";
import { additionalCases } from "./cases.js";
import { independentBash } from "./reference.js";
import { runVirtualScript } from "../helpers.js";

for (const fixture of additionalCases) {
  test(`remaining-gap independent Bash: ${fixture.name}`, { timeout: 8000 }, async () => {
    const expected = await independentBash(fixture);
    const actual = await runVirtualScript(fixture);
    assert.deepEqual(actual, expected, `${fixture.name}\nscript: ${fixture.script}\nBash: ${JSON.stringify(expected)}\nvirtual: ${JSON.stringify(actual)}`);
  });
}
