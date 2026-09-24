import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";

const cases: readonly [string, string[]][] = [
  ['c="!"; a=babc; args "${a#["$c"z]}" "${a%[\'!\'z]}" "${a//["!"z]/X}"', ["babc", "babc", "babc"]],
  ['c="!"; case b in ["$c"z]) args wrong;; *) args correct;; esac', ["correct"]],
  ['case z in ["!"z]) args correct;; *) args wrong;; esac', ["correct"]],
  ['cls=":digit:"; case 5 in [["$cls"]]) args wrong;; *) args correct;; esac', ["correct"]],
  ['cls=":digit:"; a=5; args "${a#[["$cls"]]}" "${a%[[\':digit:\']]}" "${a//[["$cls"]]/X}"', ["5", "5", "5"]],
  ['cls=":digit:"; a="d]"; args "${a#[["$cls"]]}" "${a//[["$cls"]]/X}"', ["", "X"]],
  ['a=bz5; args "${a//[!z]/X}" "${a//[[:digit:]]/X}"', ["XzX", "bzX"]],
  ["x=a; r='1\\&2'; args \"${x/a/$r}\" \"${x/a/\"$r\"}\"", ["1&2", String.raw`1\&2`]],
  ["x=aa; r='1\\\\&2'; args \"${x//a/$r}\"", [String.raw`1\a21\a2`]],
  ["x=a; r='\\q&\\'; args \"${x/a/$r}\"", ["\\qa\\"]],
];

for (const [source, expected] of cases) test(`quoted patterns and replacement escapes: ${source}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), expected);
  } finally { await shell.dispose(); }
});

test("filename globbing preserves quoted bracket operators", async () => {
  const { shell, fs } = setup();
  try {
    for (const name of ["!", "z", "b", "5", "d", ":", "d]", ":]"]) await fs.writeFile(`/${name}`, new Uint8Array());
    const result = await shell.exec('c="!"; cls=":digit:"; args ["$c"z] [["$cls"]]');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), ["!", "z", ":]", "d]"]);
  } finally { await shell.dispose(); }
});
