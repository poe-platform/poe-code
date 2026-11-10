import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { readExtension } from "../../src/shell/extensions/read/index.js";
import { bashExecutable } from "../helpers/bash-oracle.js";
import { setup } from "./helpers.js";

// Bash 5.2 has the escaped multibyte splitting bug too. Always check the
// captured Bash 5.3 results, and compare live when that oracle is available.
const version = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", '((BASH_VERSINFO[0] > 5 || BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))'], { timeout: 2000 });
assert.ifError(version.error);
assert.equal(version.signal, null);
assert.ok(version.status === 0 || version.status === 1);
const bash53 = version.status === 0;

for (const separator of [":", "é", "€", "🎈"]) {
  for (const [label, options, input, expected] of [
    ["escaped", "", `a\\${separator}b${separator}c`, [`a${separator}b`, "c"]],
    ["unescaped", "", `a${separator}b${separator}c`, ["a", "b", "c"]],
    ["raw", "-r", `a\\${separator}b${separator}c`, ["a\\", "b", "c"]],
    ["character count", "-n3", `a\\${separator}b${separator}c`, [`a${separator}b`]],
    ["escaped UTF-8", "", `a\\éb${separator}c`, ["aéb", "c"]],
  ] as const) {
    for (const array of [false, true]) {
      for (const extension of [false, true]) {
        test(`read ${label} ${separator}: array=${array}, extension=${extension}`, async t => {
          const { shell, commands } = setup({
            env: { LC_ALL: "C.UTF-8" },
            extensions: extension ? [readExtension()] : [],
          });
          t.after(() => shell.dispose());
          for (const command of basicCommands()) commands.register(command);
          const values = array ? [...expected] : [expected[0], expected.slice(1).join(separator)];
          const source = `IFS='${separator}'; a=(old stale tail); x=old; y=old; REPLY=keep; read ${options} ${array ? "-a a" : "x y"} <<< '${input}'; code=$?; printf '<%s>\\n' ${array ? '"${a[@]}"' : '"$x" "$y"'}; printf 'status=%s IFS=%s REPLY=%s\\n' "$code" "$IFS" "$REPLY"; exit "$code"`;
          const expectedOutput = new TextEncoder().encode(values.map(value => `<${value}>\n`).join("") + `status=0 IFS=${separator} REPLY=keep\n`);
          if (bash53) {
            const native = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source], {
              env: { LC_ALL: "C.UTF-8" }, timeout: 2000,
            });
            assert.ifError(native.error);
            assert.equal(native.signal, null);
            assert.equal(native.status, 0);
            assert.equal(native.stderr.length, 0);
            assert.deepEqual(new Uint8Array(native.stdout), expectedOutput);
          }
          const actual = await shell.exec(source);
          assert.equal(actual.exitCode, 0);
          assert.deepEqual(actual.stdoutBytes, expectedOutput);
          assert.equal(actual.stderr, "");
        });
      }
    }
  }
}

for (const locale of ["C", "C.UTF-8"]) {
  for (const separator of ["é", "€", "🎈"]) {
    test(`read escaped ${separator} across byte chunks preserves cursor and locale ${locale}`, async t => {
      const { shell, commands } = setup({ env: { LC_ALL: locale } });
      t.after(() => shell.dispose());
      for (const command of basicCommands()) commands.register(command);
      const input = new TextEncoder().encode(`a\\${separator}b${separator}c\nTAIL\n`);
      const source = `IFS='${separator}'; read -n3 -a a; code=$?; IFS= read -r rest; IFS= read -r tail; printf '%s\\n' "$code" "\${a[@]}" "$rest" "$tail"; exit "$code"`;
      const native = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source], {
        input, env: { LC_ALL: locale }, timeout: 2000,
      });
      assert.ifError(native.error);
      assert.equal(native.signal, null);
      assert.equal(native.status, 0);
      assert.equal(native.stderr.length, 0);
      const expectedOutput = locale === "C" ? new Uint8Array(native.stdout)
        : new TextEncoder().encode(`0\na${separator}b\n${separator}c\nTAIL\n`);
      if (locale === "C" || bash53) assert.deepEqual(new Uint8Array(native.stdout), expectedOutput);
      const stdin = { async *[Symbol.asyncIterator]() { for (const byte of input) yield Uint8Array.of(byte); } };
      const actual = await shell.exec(source, { stdin });
      assert.equal(actual.exitCode, native.status);
      assert.deepEqual(actual.stdoutBytes, expectedOutput);
      assert.deepEqual(actual.stderrBytes, new Uint8Array(native.stderr));
    });
  }
}
