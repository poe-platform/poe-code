import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { positionalSubstringCases } from "./substring-positional.js";
import type { PositionalSubstringReference } from "./substring-positional.js";
import { virtualSubstring } from "./substring-native.js";

const reference = JSON.parse(await readFile(new URL("./substring-positional-native.json", import.meta.url), "utf8")) as PositionalSubstringReference;
for (const fixture of positionalSubstringCases) test(`substring positional: ${fixture.name}`, async () => {
  const actual = await virtualSubstring(fixture, "C");
  for (const profile of reference.profiles) assert.deepEqual(actual, profile.rows.find(row => row.name === fixture.name)!.expected);
});
