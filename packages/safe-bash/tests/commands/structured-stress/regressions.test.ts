import { test } from "node:test";
import { check } from "./harness.js";
import { regressions } from "./regressions.js";
import { reviewed } from "./corpus.js";

for (const fixture of regressions) test(`independent regression: ${fixture.id}`, { timeout: 3000 }, () => check(fixture));
for (const fixture of reviewed.fixtures) test(`reverified reviewer regression: ${fixture.id}`, { timeout: 3000 }, () => check(fixture));
