import assert from "node:assert/strict";
import test from "node:test";
import { Selection } from "../../src/commands/archive/unzip/arguments.js";
import { settings } from "../../src/commands/archive/internal.js";
import { readZipArchive } from "../../src/commands/archive/zip-format.js";
import { archiveBytes, execute, fixture } from "./zip-standard-flags.helpers.js";

const names = ["a", "b", "c", "-", "!", "^", "]", "[", "z"];

// Manual native Zip 3.0 delete and UnZip 6.0 selection captures agree.
for (const [pattern, expected] of [
  ["[a-]", []], ["[-a]", ["a", "-"]], ["[a-b-c]", ["b", "c"]],
  ["[z-a]", []], ["[]", []], ["[!]", names], ["[a\\-]", ["a", "-"]],
  ["[a-b-]", []], ["[a-c]", ["a", "b", "c"]], ["[\\]]", ["]"]],
  ["[!a-b-c]", names.filter(name => name !== "b" && name !== "c")],
] as const) {
  test(`Info-ZIP character class ${pattern} matches native range grammar`, async () => {
    const selection = new Selection([pattern], settings({}), new AbortController().signal);
    const actual: string[] = [];
    for (const name of names) if (await selection.matches(name)) actual.push(name);
    assert.deepEqual(actual, expected);
  });
}

for (const pattern of ["[a-]", "[a-b-c]", "[a-b-]"]) {
  test(`ZIP deletion and UnZip payload selection apply native ${pattern} grammar`, async () => {
    const fs = await fixture(await archiveBytes(names.map(name => ({ name, body: Buffer.from(name) }))));
    const selected = pattern === "[a-b-c]" ? ["b", "c"] : [];
    const extracted = await execute("unzip", fs, ["-p", "sample.zip", pattern]);
    assert.equal(extracted.exitCode, selected.length ? 0 : 11, extracted.stderr);
    assert.equal(extracted.stdout.toString(), selected.join(""));
    const result = await execute("zip", fs, ["-qd", "sample.zip", pattern]);
    assert.equal(result.exitCode, selected.length ? 0 : 12, result.stdout.toString() + result.stderr);
    const archive = await readZipArchive(await fs.readFile("/work/sample.zip"), settings({}), new AbortController().signal);
    assert.deepEqual(archive.entries.map(entry => entry.name), names.filter(name => !selected.includes(name)));
  });
}
