import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { standardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";
import { Shell } from "../../src/shell/index.js";
import { bashExecutable } from "../helpers/bash-oracle.js";

test("directory stack tildes expand arguments and cd destinations", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { HOME: "/", LC_ALL: "C" }, extensions: [arraysExtension()] })
    .use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`mkdir -p a b; pushd a >/dev/null; pushd ../b >/dev/null; printf '%s\\n' ~1 ~+1 ~-0 '~1' ~9; cd ~1 && echo "\${PWD##*/}"`);
  assert.equal(result.stdout, "/a\n/a\n/\n~1\n~9\na\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

const cases = [
  ["indexes from either end", String.raw`printf '<%s>\n' ~0 ~1 ~2 ~+0 ~+1 ~+2 ~-0 ~-1 ~-2 ~01 ~+01 ~-02`],
  ["invalid and out of range indexes", String.raw`printf '<%s>\n' ~3 ~+3 ~-3 ~999999999999999999999999 ~1x ~1.0 ~1e0 ~0x1 ~++1 ~--1`],
  ["quoted and escaped prefixes", `printf '<%s>\\n' '~1' "~+1" \\~-0 ~\\1 ~1"" ~"1" ~1/"child" ~1/\${missing}`],
  ["assignments and parameter operands", `p=~1/a:~+2/b:~-2/c; export q=~+1; printf '<%s>\\n' "$p" "$q" \${missing:-~1} \${missing:=~-0} "$missing"; x=/usr/file; printf '<%s>\\n' \${x#~1} \${x/~1/~+2}`],
  ["protected stack entries", `pushd -n 'a b*' >/dev/null; IFS=' /'; printf '<%s>\\n' ~1 ~+1/child \${missing:-~1}; pushd -n '' >/dev/null; printf '<%s>\\n' ~1`],
  ["current directory variable", String.raw`PWD=/custom; printf '<%s>\n' ~0 ~+0 ~-2; unset PWD; printf '<%s>\n' ~0 ~+0 ~-2 ~1; PWD=; printf '<%s>\n' ~0 ~+0 ~-2`],
  ["live stack in repeated function calls", String.raw`f() { printf '<%s>\n' ~0 ~1 ~-0; }; for i in 1 2; do f; popd >/dev/null; done; dirs -c; f`],
  ["subshell and command substitution", String.raw`(popd >/dev/null; printf '<%s>\n' ~1 ~-0); printf '<%s>\n' "$(printf '%s' ~1)" ~0 ~1`],
] as const;

for (const ordinary of [false, true]) {
  for (const [name, script] of cases) {
    test(`directory stack tildes: ${name} (ordinary=${ordinary})`, async context => {
      const env = { HOME: "/", LC_ALL: "C", PATH: "/usr/bin:/bin" };
      const source = `pushd /usr >/dev/null; pushd /dev >/dev/null; ${script}`;
      const expected = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source], { cwd: "/", env, encoding: "utf8", timeout: 2000 });
      assert.ifError(expected.error);
      assert.equal(expected.signal, null);
      assert.equal(expected.status, 0, expected.stderr);
      const fs = new MemoryFileSystem();
      await fs.mkdir("/usr");
      const shell = new Shell({ fs, env }).use(standardCommands());
      if (ordinary) shell.use(async (_context, next) => next());
      context.after(() => shell.dispose());
      const actual = await shell.exec(source);
      assert.equal(actual.stdout, expected.stdout);
      assert.equal(actual.stderr, expected.stderr);
      assert.equal(actual.exitCode, expected.status);
    });
  }
}
