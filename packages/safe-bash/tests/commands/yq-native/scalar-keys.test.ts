import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./helpers.js";

for (const [input, tag] of [
  ["true\n", "!!bool"],
  ["ChangedText\n", "!!str"],
  ["23\n", "!!int"],
  ["1.5\n", "!!float"],
  ["~\n", "!!null"],
  ["", "!!null"],
  ["!owned value\n", "!owned"],
] as const) {
  test(`Mike yq keys rejects ${tag} scalar ${JSON.stringify(input)}`, async () => {
    assert.deepEqual(await run(["keys"], input), {
      status: 1,
      stdout: "",
      stderr: `Error: cannot get keys of ${tag}, keys only works for maps and arrays\n`,
    });
  });
}

test("Mike yq keys preserves map and sequence results", async () => {
  for (const [input, stdout] of [
    ["owned: true\nother: null\n", '["owned","other"]\n'],
    ["- true\n- value\n", "[0,1]\n"],
    ["{}\n", "[]\n"],
    ["[]\n", "[]\n"],
  ] as const) {
    assert.deepEqual(await run(["-o=json", "-I=0", "keys"], input), {
      status: 0, stdout, stderr: "",
    });
  }
});

test("Mike yq keys rejects a selected scalar and an alias to a scalar", async () => {
  for (const input of ["owned: false\n", "source: &scalar false\nowned: *scalar\n"]) {
    assert.deepEqual(await run([".owned | keys"], input), {
      status: 1, stdout: "",
      stderr: "Error: cannot get keys of !!bool, keys only works for maps and arrays\n",
    });
  }
});
