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

const slices = [
  { source: 'set -- a b c; printf "%s\\n" "${@:2:1}" "${*:2:1}"', stdout: "b\nb\n" },
  { source: 'set -- "a b" "" c d; printf "<%s>" "pre${@:1:3}post"', stdout: "<prea b><><cpost>" },
  { source: 'set -- a b c; IFS=:; printf "<%s>" "${*:1:2}" "${@: -2}"', stdout: "<a:b><b><c>" },
  { source: 'set -- a b c; n=1; printf "<%s>" "${@:n+1:1}" "${@:0:2}"', stdout: "<b><shell><a>" },
  { source: 'set -- a b c; printf "<%s>" "${@:9}" "${@:1:0}" end', stdout: "<end>" },
  { source: 'set -- "a b" c; printf "<%s>" ${@:1:1} ${*:2:1}', stdout: "<a><b><c>" },
  { source: 'set --; printf "<%s>" "${@:0:1}" "${*:1}" end', stdout: "<shell><><end>" },
  { source: 'set -- a b c; printf "<%s>" "${@: -9}" end', stdout: "<end>" },
  { source: 'set -- a b c; value="${@:2:2}"; printf "<%s>" "$value"', stdout: "<b c>" },
  { source: 'set -- a b c; IFS=; printf "<%s>" ${@:1:2} ${*:1:2}', stdout: "<a><b><a><b>" },
  { source: 'set -- a b c; printf "<%s>" "${@:1:999999999999}"', stdout: "<a><b><c>" },
  { source: 'set -- a b c; printf "<%s>" "${@: -5:-1}" "${@:9:-1}" end', stdout: "<end>" },
  { source: 'set -- "a b" "" c; IFS=:; printf "<%s>" ${@:2:2} ${*:2:2}', stdout: "<><c><><c>" },
];
for (const fixture of slices) test(`positional aggregate slice: ${fixture.source}`, async () => {
  const actual = await virtualSubstring({ ...fixture, name: fixture.source }, "C");
  assert.deepEqual(actual, { stdout: Buffer.from(fixture.stdout).toString("base64"), stderr: "", status: 0, files: {} });
});
test("positional aggregate slices reject negative lengths", async () => {
  const actual = await virtualSubstring({ name: "negative-length", source: 'set -- a b; printf "%s" "${@:1:-1}"; echo unreachable' }, "C");
  assert.notEqual(actual.status, 0);
  assert.match(Buffer.from(actual.stderr, "base64").toString(), /substring expression < 0/u);
  assert.equal(actual.stdout, "");
});
test("positional slices preserve invalid UTF-8 bytes", async () => {
  const actual = await virtualSubstring({ name: "raw-byte-slice", source: 'set -- a "$(printf "\\377")" c; printf "%s" "${@:2:1}" "${*:2:1}"' }, "C");
  assert.deepEqual(actual, { stdout: Buffer.from([255, 255]).toString("base64"), stderr: "", status: 0, files: {} });
});
