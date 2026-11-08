import assert from "node:assert/strict";
import { test } from "node:test";
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
