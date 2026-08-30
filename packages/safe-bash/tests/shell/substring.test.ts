import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { substringCases } from "./substring-cases.js";
import { virtualSubstring } from "./substring-native.js";
import type { SubstringReference } from "./substring-native.js";

const reference = JSON.parse(await readFile(new URL("./substring-native.json", import.meta.url), "utf8")) as SubstringReference;
for (const locale of reference.profiles[0]!.locales) for (const fixture of substringCases) test(`substring ${locale.locale}: ${fixture.name}`, { timeout: 3000 }, async () => {
  const actual = await virtualSubstring(fixture, locale.locale);
  if (locale.locale === "C" && fixture.byteFragment) {
    assert.equal(actual.status, 1);
    assert.equal(actual.stdout, "");
    assert.equal(Buffer.from(actual.stderr, "base64").toString(), "shell: line 1: substring expansion splits a UTF-8 character in a byte locale\n");
    assert.deepEqual(actual.files, {});
  } else assert.deepEqual(actual, locale.rows.find(row => row.name === fixture.name)!.expected);
});
