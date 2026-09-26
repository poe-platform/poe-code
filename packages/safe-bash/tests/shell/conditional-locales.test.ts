import assert from "node:assert/strict";
import { test } from "node:test";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";
import { setup } from "./helpers.js";

for (const locale of ["C", "POSIX", "C.UTF-8", "C.utf8", "en_US.UTF-8"]) {
  for (const source of [
    ...["!", "?", "*", "+", "@"].map(member => `pat='[${member}()]'; [[ '${member === "!" ? "a" : member}' == $pat ]]`),
    '[[ a == @(a) && b != @(a) ]]',
    '[[ foo == foo && foo = f* && foo != bar && foo.txt == *.txt ]]',
    'pat="^a(.)c$"; [[ abc =~ $pat ]] && [[ ${BASH_REMATCH[0]} == abc && ${BASH_REMATCH[1]} == b ]]',
  ]) {
    test(`conditional locale ${locale}: ${source}`, async context => {
      const { shell } = setup({ extensions: [arraysExtension()] });
      context.after(() => shell.dispose());
      const result = await shell.exec(source, { env: { LC_ALL: locale } });
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
}

for (const source of [
  'LC_ALL=C.UTF-8; [[ b == [a-c] ]] && [[ b =~ [a-c] ]]',
  'LANG=en_US.UTF-8; LC_ALL=C; [[ b == [a-c] ]] && [[ b =~ [a-c] ]]',
  'LANG=en_US.UTF-8; LC_COLLATE=C; LC_CTYPE=C; [[ b =~ [a-c] ]]',
  'LANG=en_US.UTF-8; pat="[a-c]"; [[ a =~ "$pat" ]] || [[ $? == 1 ]]',
]) {
  test(`conditional locale precedence: ${source}`, async context => {
    const { shell } = setup({ extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const expression of ['[[ a == [a-z] ]]', '[[ a =~ [a-z] ]]', '[[ a =~ [[:alpha:]] ]]', '[[ a == [[:alpha:]] ]]']) {
  test(`unsupported locale-sensitive conditional: ${expression}`, async context => {
    const { shell } = setup({ extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    const result = await shell.exec(expression, { env: { LC_ALL: "en_US.UTF-8" } });
    assert.equal(result.exitCode, 2);
    assert.ok(result.stderr.includes("unsupported"));
  });
}
