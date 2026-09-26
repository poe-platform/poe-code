import assert from "node:assert/strict";
import test from "node:test";
import { resolveYqLimits } from "./accounting.js";
import { limitsFor } from "./native-work.js";

for (const [name, settings] of [["query", resolveYqLimits], ["native", limitsFor]] as const) {
  test(`yq ${name} quotas are opt-in and accept explicit Infinity`, () => {
    const defaults = settings();
    for (const [key, value] of Object.entries(defaults)) {
      assert.equal(value, Infinity, key);
      assert.deepEqual(settings({ [key]: Infinity }), defaults);
      assert.deepEqual(settings({ [key]: 8 }), { ...defaults, [key]: 8 });
      for (const value of [-Infinity, NaN, -1, 0.5]) assert.throws(() => settings({ [key]: value }), TypeError);
    }
  });
}
