import assert from "node:assert/strict";
import { test } from "node:test";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";
import { setup } from "./helpers.js";

for (const source of [
  '[[ "5" == [[:digit:]] ]] && echo match',
  '[[ a == [[:alpha:]] && z != [[:digit:]] ]] && echo match',
  '[[ "[" == [[] && "[" == [a[b] ]] && echo match',
  '[[ "[[:digit:]]" == "[[:digit:]]" ]] && echo match',
  'x=5; [[ x -eq 5 ]] && [[ 2+3 -eq 5 ]] && echo match',
  'x=2+3; [[ x -ne 6 && x -lt 6 && x -le 5 && x -gt 4 && x -ge 5 ]] && echo match',
  'x=1; [[ "x+=2" -eq 3 && x -eq 3 ]] && echo match',
  '[[ missing -eq 0 && "" -eq 0 && 16#ff -eq 255 && 010 -eq 8 ]] && echo match',
  '[[ yes == yes || 1/0 -eq 0 ]] && echo match',
]) {
  test(`conditional patterns and arithmetic: ${source}`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(source.replaceAll("echo match", "say match"));
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "match\n");
  });
}

for (const mode of ["single", "loop", "sync"] as const) {
  test(`BASH_REMATCH follows the Darwin last-parent capture profile (${mode})`, async context => {
    const { shell } = setup({ extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    const capture = '"$?:<${BASH_REMATCH[0]}>:<${BASH_REMATCH[1]}>:<${BASH_REMATCH[2]}>"';
    const condition = `[[ $subject =~ $pat ]]; ${mode === "sync" ? "result=" : "say "}${capture}`;
    for (const [subject, expected] of [
      ["aba", "0:<aba>:<a>:<>\n"],
      ["ab", "0:<ab>:<ab>:<b>\n"],
      ["a", "0:<a>:<a>:<>\n"],
      ["ababa", "0:<ababa>:<a>:<>\n"],
      ["z", "1:<>:<>:<>\n"],
    ] as const) {
      const source = `LC_ALL=C; pat='(a(b)?)+'; subject=${subject}; ${mode === "single" ? condition : `for i in 1 2; do ${condition}; done`}${mode === "sync" ? '; say "$result"' : ""}`;
      const result = await shell.exec(source);
      assert.equal(result.stdout, expected.repeat(mode === "loop" ? 2 : 1));
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    }
  });
}
