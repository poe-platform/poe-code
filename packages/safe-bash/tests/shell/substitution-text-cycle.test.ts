import assert from "node:assert/strict";
import { test } from "node:test";
import { standardCommands } from "../../src/commands/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const cases = [
  ["sed '1d;2d'", "a\\nb\\nc\\n", "c"],
  ["sed -e 1d -e 2d", "a\\nb\\nc\\n", "c"],
  ["sed '1d;1d'", "a\\nb\\n", "b"],
  ["sed '1,2d;3d'", "a\\nb\\nc\\nd\\n", "d"],
  ["sed 's/a/b/;1d;2d'", "a\\nb\\nc\\n", "c"],
  ["grep -Eo 'a|ab'", "ab\\n", "ab"],
  ["grep -oE 'a|ab|abc'", "abcab\\n", "abc\nab"],
  ["grep -Eo 'b|ab'", "ab\\n", "ab"],
  ["grep -Eo 'a|ab+'", "abbb\\n", "abbb"],
  ["grep -Eo '(a|ab)'", "ab\\n", "ab"],
  ["grep -Eo 'a+|a+b'", "aab\\n", "aab"],
  ["grep -Eio 'a|AB'", "aB\\n", "aB"],
  ["grep -Eno 'a|ab'", "x\\nab\\n", "2:ab"],
  ["grep -Eo '[a|b]+'", "a|b\\n", "a|b"],
] as const;

const posixCases = [
  ["grep -E '[]a]'", "]\\na\\nb\\n", "]\na", 0],
  ["grep -E '[^]a]'", "]\\na\\nb\\n", "b", 0],
  ["grep -E '[]|a]'", "]\\n|\\na\\nb\\n", "]\n|\na", 0],
  ["grep -E '[a|b]'", "a\\n|\\nb\\nc\\n", "a\n|\nb", 0],
  ["grep -Eo '[]a]'", "]\\na\\n", "]\na", 0],
  ["grep '[]a]'", "]\\na\\nb\\n", "]\na", 0],
  ["grep -Eo '[0-9]*'", "a1b2\\n", "1\n2", 0],
  ["grep -Eo 'b?'", "abc\\n", "b", 0],
  ["grep -Eno 'b?'", "abc\\n", "1:b", 0],
  ["grep -Eo 'x*'", "abc\\n", "", 0],
  ["grep -Eo 'x+'", "abc\\n", "", 1],
  ["sed -E 's/[[:digit:]]+/X/g'", "123\\n", "X", 0],
  ["sed -E 's/[[:alpha:]]+/X/g'", "abc\\n", "X", 0],
  ["sed -E 's/[[:alnum:]]+/X/g'", "a1\\n", "X", 0],
  ["sed -E 's/[[.a.]]/X/g'", "ab\\n", "", 2],
  ["sed -E 's/[[=a=]]/X/g'", "ab\\n", "", 2],
  ["sed -E 's/[]a]/X/g'", "]a\\n", "XX", 0],
  ["sed -E 's/[^]a]/X/g'", "]ab\\n", "]aX", 0],
  ["sed -E 's/foo|foobar/X/'", "foobar\\n", "X", 0],
  ["sed -E 's/(foo|foobar)/[\\1]/'", "foobar\\n", "[foobar]", 0],
] as const;

for (const [command, input, expected, status] of posixCases) {
  test(`POSIX matching survives substitution optimizations: ${command}`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(textProgramCommands());
    t.after(() => shell.dispose());
    const pipeline = `printf '${input}' | ${command}`;
    const direct = await shell.exec(pipeline);
    assert.equal(direct.exitCode, status, direct.stderr);
    assert.equal(direct.stdout, expected ? expected + "\n" : "");
    const diagnostic = status === 2 ? "sed: collating and equivalence classes are not supported\n" : "";
    assert.equal(direct.stderr, diagnostic);
    for (const script of [
      `value=$(${pipeline}); status=$?; printf '%s\\n%s\\n' "$value" "$status"`,
      `for i in 1 2; do value=$(${pipeline}); status=$?; done; printf '%s\\n%s\\n' "$value" "$status"`,
    ]) {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, `${expected}\n${status}\n`);
      assert.equal(result.stderr, script.startsWith("for ") ? diagnostic.repeat(2) : diagnostic);
    }
  });
}

for (const [command, input, expected] of cases) {
  test(`substitution preserves text command semantics: ${command}`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(textProgramCommands());
    t.after(() => shell.dispose());
    for (let warmup = 0; warmup < 2; warmup++) {
      const result = await shell.exec(`echo "$(printf '${input}' | ${command})"`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected + "\n");
      assert.equal(result.stderr, "");
    }
  });
}

for (const delimiter of ["\\:", "\\:\\:", "\\:\\:\\:"]) {
  test(`nl here-string substitution honors page delimiter ${delimiter}`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(textProgramCommands());
    t.after(() => shell.dispose());
    const command = `nl <<< $'a\\n${delimiter.replaceAll("\\", "\\\\")}\\nb'`;
    const direct = await shell.exec(command);
    assert.equal(direct.exitCode, 0, direct.stderr);
    assert.equal(direct.stdout, delimiter === "\\:\\:" ? "     1\ta\n\n     1\tb\n" : "     1\ta\n\n       b\n");
    for (let warmup = 0; warmup < 2; warmup++) {
      const result = await shell.exec(`echo "$( ${command} )"`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, direct.stdout);
    }
  });
}

const wave112Cases = [
  ["awk '{ print index($1, \"\") }'", "abc\\n", "1\n", 0],
  ["awk '{ print index($1, \"a\") }'", "😀a\\n", "5\n", 0],
  ["grep -o -m 1 'a'", "aa\\nab\\n", "a\na\n", 0],
  ["grep --only-matching --max-count=1 'a'", "ab\\nab\\n", "a\n", 0],
  ["grep -Eo 'a*'", "bab\\n", "a\n", 0],
  ["grep -no -m1 'a'", "x\\naa\\nab\\n", "2:a\n2:a\n", 0],
  ["grep -Eo -m1 'a*'", "bbb\\na\\n", "", 0],
  ["grep -Eo '[[:digit:]]+'", "x123\\n", "123\n", 0],
  ["grep -Eo '[[:alpha:]]+'", "123abc\\n", "abc\n", 0],
  ["grep -Ei 'ä'", "Ä\\n", "", 2],
  ["grep -Eio '[A-Z]+'", "ſKAa\\n", "Aa\n", 0],
  ["sed -n '=' | wc -c", "a", "2\n", 0],
] as const;

for (const [command, input, expected, status] of wave112Cases) {
  test(`Wave 112 direct and substitution parity: ${command}`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(textProgramCommands());
    t.after(() => shell.dispose());
    const pipeline = `printf '${input}' | ${command}`;
    const direct = await shell.exec(pipeline);
    assert.equal(direct.stdout, expected);
    assert.equal(direct.exitCode, status, direct.stderr);
    for (const script of [
      `value=$(${pipeline}); status=$?; printf '%s\\n%s\\n' "$value" "$status"`,
      `for i in 1 2; do value=$(${pipeline}); status=$?; done; printf '%s\\n%s\\n' "$value" "$status"`,
    ]) {
      const result = await shell.exec(script);
      assert.equal(result.stdout, `${expected.trimEnd()}\n${status}\n`);
      assert.equal(result.stderr, script.startsWith("for ") ? direct.stderr.repeat(2) : direct.stderr);
      assert.equal(result.exitCode, 0);
    }
  });
}
