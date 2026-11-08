import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pluginFixtures } from "../../../../benchmarks/plugin-fixtures.ts";
import { deterministicCases, parseFixtures, probes } from "../../../../benchmarks/fixtures.ts";
import { dialectFixtures } from "../../../../benchmarks/dialect-fixtures.ts";

const fixtures = [...parseFixtures(readFileSync(join(process.cwd(), "tests/fixtures/shell-cases.json"), "utf8")), ...deterministicCases(1526603814), ...pluginFixtures(), ...dialectFixtures()];
const fixture = fixtures.find(item => item.name === "plugin-diff-patch-roundtrip");
assert(fixture);
console.log(JSON.stringify({ fixtureCount: fixtures.length, probeCount: probes.length, taskCount: fixtures.length + probes.length, fixture }, null, 2));
