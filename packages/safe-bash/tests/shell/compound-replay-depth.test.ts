import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { standardCommands } from "../../src/commands/index.js";
import { setup } from "./helpers.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";

for (const ordinary of [false, true]) {
  for (const [body, expected] of [
    ['{ n=$((n + 1)); x="a$(cat /dev/null)"; }', '1'],
    ['if n=$((n + 1)); [[ $n =~ ^1$ ]]; then result=THEN; else result=ELSE; fi', '1THEN'],
    ['case a in a) n=$((n + 1)); x="a$(cat /dev/null)";; esac', '1'],
    ['f() { n=$((n + 1)); local x="a$(cat /dev/null)"; }; f 1', '1'],
    ['{ n=$((n + 1)); arr+=("a$(cat /dev/null)"); }', '1'],
    ['if true; then n=$((n+1)); x="a$(cat /dev/null)"; fi', '1'],
    ['if false; then :; else n=$((n+1)); x="a$(cat /dev/null)"; fi', '1'],
  ]) {
    test(`compound executes once (ordinary=${ordinary}): ${body}`, async t => {
      const { shell } = setup();
      shell.use(standardCommands());
      if (ordinary) shell.use(async (_context, next) => next());
      t.after(() => shell.dispose());
      const result = await shell.exec(`:; n=0; ${body}; echo "$n$result"`);
      assert.equal(result.stdout, `${expected}\n`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
  for (const limit of ["maxFunctionDepth", "maxSubstitutionDepth"] as const) {
    test(`function ceiling ${limit} (ordinary=${ordinary})`, async t => {
      const { shell } = setup({ limits: { [limit]: 1 } });
      if (ordinary) shell.use(async (_context, next) => next());
      t.after(() => shell.dispose());
      await assert.rejects(shell.exec(':; f3() { :; }; f2() { f3 1; }; f1() { f2 1; }; f1 1'),
        error => error instanceof ShellLimitError && error.limit === limit);
    });
  }
  test(`function depth is concurrent, restored after fallback (ordinary=${ordinary})`, async t => {
    const { shell, commands } = setup({ limits: { maxFunctionDepth: 1 } });
    for (const command of basicCommands()) commands.register(command);
    if (ordinary) shell.use(async (_context, next) => next());
    t.after(() => shell.dispose());
    const result = await shell.exec(':; n=0; f() { n=$((n+1)); local x="a$(pass /dev/null)"; return 0; }; f 1; f 2; echo "$n"');
    assert.equal(result.stdout, "2\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
  test(`zero function depth permits substitutions but rejects calls (ordinary=${ordinary})`, async t => {
    const { shell, commands } = setup({ limits: { maxFunctionDepth: 0 } });
    for (const command of basicCommands()) commands.register(command);
    if (ordinary) shell.use(async (_context, next) => next());
    t.after(() => shell.dispose());
    assert.equal((await shell.exec('echo "$(echo ok)"')).stdout, "ok\n");
    await assert.rejects(shell.exec(':; f() { :; }; f'),
      error => error instanceof ShellLimitError && error.limit === "maxFunctionDepth");
  });
  test(`function calls consume the command budget (ordinary=${ordinary})`, async t => {
    const { shell } = setup({ limits: { maxCommands: 3 } });
    if (ordinary) shell.use(async (_context, next) => next());
    t.after(() => shell.dispose());
    await assert.rejects(shell.exec(':; f() { :; }; f 1; f 2'),
      error => error instanceof ShellLimitError && error.limit === "maxCommands");
  });
}

for (const ordinary of [false, true]) {
  test(`pure substitution respects the independent function ceiling (${ordinary})`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxFunctionDepth: 1 } });
    shell.use(standardCommands());
    if (ordinary) shell.use(async (_context, next) => next());
    t.after(() => shell.dispose());
    await assert.rejects(shell.exec('inner() { echo inside; }; outer() { local x=$(inner); echo "$x"; }; outer'),
      error => error instanceof ShellLimitError && error.limit === 'maxFunctionDepth');
  });
}

for (const limit of ['maxFunctionDepth', 'maxSubstitutionDepth'] as const) {
  test(`pure function bodies respect nested ${limit}`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem(), limits: { [limit]: limit === 'maxFunctionDepth' ? 1 : 3 } }).use(standardCommands());
    t.after(() => shell.dispose());
    await assert.rejects(shell.exec('g() { echo nested; }; f() { echo "${missing:-$(g)}"; }; value=$(f)'),
      error => error instanceof ShellLimitError && error.limit === limit);
  });
}
