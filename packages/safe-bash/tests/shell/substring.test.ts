import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { substringCases } from "./substring-cases.js";
import { virtualSubstring } from "./substring-native.js";
import type { SubstringReference } from "./substring-native.js";

const reference = JSON.parse(await readFile(new URL("./substring-native.json", import.meta.url), "utf8")) as SubstringReference;
for (const locale of reference.profiles[0]!.locales) for (const fixture of substringCases) test(`substring ${locale.locale}: ${fixture.name}`, { timeout: 3000 }, async () => {
  const actual = await virtualSubstring(fixture, locale.locale);
  assert.deepEqual(actual, locale.rows.find(row => row.name === fixture.name)!.expected);
});
