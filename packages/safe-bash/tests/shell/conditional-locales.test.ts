import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";
import { setup } from "./helpers.js";

for (const locale of ["C", "C.UTF-8"]) {
  for (const loop of [false, true, "sync"] as const) {
    for (const [subject, pattern, syntaxStatus] of [
      ["hello\nworld", "^(.+)$"],
      ["foo\n", "^foo$"],
      ["foo\n", "^(foo)$"],
      ["a", "^(a?)$"],
      ["a]", "^[]a]+$"],
      ["b\n", "^[^]a]+$"],
      ["foo", "^(?:foo)$"],
      ["foo", "^(?=foo)foo$"],
      ["foo", "^(?!bar)foo$"],
      // Repeated quantifiers are undefined by POSIX; this engine rejects them.
      ["aaa", "^(a+?)$", "2:<>:<>:<>\n"],
      ["aa", "^(a??)$", "2:<>:<>:<>\n"],
    ]) {
      test(`ERE native semantics ${locale}, loop=${loop}: ${pattern}`, async context => {
        const { shell } = setup({ extensions: [arraysExtension()] });
        context.after(() => shell.dispose());
        const capture = `"$?:<\${BASH_REMATCH[0]}>:<\${BASH_REMATCH[1]}>:<\${BASH_REMATCH[2]}>"`;
        const condition = `[[ $subject =~ ${pattern} ]]; ${loop === "sync" ? "result=" : "say "}${capture}`;
        const source = `subject='${subject}'; ${loop ? `for i in 1 2; do ${condition}; done` : condition}${loop === "sync" ? '; say "$result"' : ""}`;
        const expected = syntaxStatus?.repeat(loop === true ? 2 : 1) ?? execFileSync("/bin/bash", ["--noprofile", "--norc", "-c", `say() { printf '%s\\n' "$*"; }; ${source}`], {
          encoding: "utf8", env: { LC_ALL: locale, BASH_ENV: "/dev/null" },
        });
        const result = await shell.exec(source, { env: { LC_ALL: locale } });
        assert.equal(result.stdout, expected);
        assert.equal(result.exitCode, 0);
      });
    }
  }
}

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
