import { Runtime } from "../../src/shell/runtime.js";
import type { State } from "../../src/shell/runtime.js";
import { arrayStore } from "../../src/shell/arrays/state.js";
import { ArrayFailure } from "../../src/shell/arrays/ledger.js";
import type { Charge } from "../../src/shell/arrays/ledger.js";
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
  test(`parameter patterns expand leading tilde (${ordinary})`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    shell.use(standardCommands());
    if (ordinary) shell.use(async (_context, next) => next());
    t.after(() => shell.dispose());
    const result = await shell.exec('HOME=/home/alice; x=/home/alice/bin; y=/bin/home/alice; printf "%s\\n" ${x#~} ${x##~} ${y%~} ${y%%~} ${x/~//usr} ${x//~//usr}');
    assert.equal(result.stdout, '/bin\n/bin\n/bin\n/bin\n/usr/bin\n/usr/bin\n');
    assert.equal(result.stderr, '');
  });
  test(`associative subscript executes once when the value suspends (${ordinary})`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    shell.use(standardCommands());
    if (ordinary) shell.use(async (_context, next) => next());
    t.after(() => shell.dispose());
    const result = await shell.exec('declare -A map; i=0; map[$((i++))]="$(cat /dev/null)"; echo "$i:${!map[@]}"');
    assert.equal(result.stdout, '1:0\n');
    assert.equal(result.stderr, '');
  });
}

for (const source of ['arr=(seed); arr+=(portable)', 'declare -A map; map[key]=portable; map[key]+=value']) {
  test(`array assignments do not require Buffer: ${source}`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    t.after(() => shell.dispose());
    const buffer = globalThis.Buffer;
    try {
      Reflect.deleteProperty(globalThis, 'Buffer');
      const result = await shell.exec(`${source}; echo "${'${arr[*]}${map[key]}'}"`);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, source.startsWith('arr') ? 'seed portable\n' : 'portablevalue\n');
    } finally { globalThis.Buffer = buffer; }
  });
}

for (const failure of ['limit', 'abort'] as const) {
  test(`array expansion propagates ${failure} without retrying`, async t => {
    const controller = new AbortController();
    const reason = failure === 'limit' ? new ShellLimitError('maxExpansionBytes') : new Error('cancel array expansion');
    const runtime = Runtime.prototype as unknown as {
      tryFastArrayAssignmentSync(...args: unknown[]): boolean;
      fastValueWord(word: { plain?: string }, ...args: unknown[]): unknown;
    };
    let active = false;
    let attempts = 0;
    const assign = runtime.tryFastArrayAssignmentSync;
    t.mock.method(runtime, 'tryFastArrayAssignmentSync', function (this: typeof runtime, ...args: unknown[]) {
      active = true;
      try { return assign.apply(this, args); } finally { active = false; }
    });
    const expand = runtime.fastValueWord;
    t.mock.method(runtime, 'fastValueWord', function (this: typeof runtime, word: { plain?: string }, ...args: unknown[]) {
      if (active && word.plain === 'sentinel') {
        attempts++;
        if (failure === 'abort') controller.abort(reason);
        throw reason;
      }
      return expand.call(this, word, ...args);
    });
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    t.after(() => shell.dispose());
    await assert.rejects(shell.exec('declare -A map; map[seed]=ok; map[key]=sentinel', { signal: controller.signal }), error => error === reason);
    assert.equal(attempts, 1);
  });
}

for (const resource of ['payload', 'slots'] as const) {
  test(`associative ${resource} reservation failure leaves no orphan key`, async t => {
    const runtime = Runtime.prototype as unknown as {
      tryFastArrayAssignmentSync(assignment: { kind: string; name: string; value?: { plain?: string } }, state: State, ...args: unknown[]): boolean;
    };
    const assign = runtime.tryFastArrayAssignmentSync;
    let checked = false;
    t.mock.method(runtime, 'tryFastArrayAssignmentSync', function (this: typeof runtime, assignment: { kind: string; name: string; value?: { plain?: string } }, state: State, ...args: unknown[]) {
      const binding = arrayStore(state)?.get('map');
      if (checked || assignment.name !== 'map' || assignment.value?.plain !== 'sentinel' || !binding) return assign.call(this, assignment, state, ...args);
      checked = true;
      const before = binding.owner.ledger.snapshot().used.slice(0, 4);
      const reserve = binding.owner.reserve;
      const reservation = t.mock.method(binding.owner, 'reserve', function (this: typeof binding.owner, charge: Charge) {
        if ((resource === 'payload' && charge.payload === 8) || (resource === 'slots' && charge.slots === 1)) throw new ArrayFailure('injected reservation refusal');
        return reserve.call(this, charge);
      });
      try {
        assert.equal(assign.call(this, assignment, state, ...args), false);
        assert.equal(binding.keys.size, 1);
        assert.equal(binding.keyByIndex.size, 1);
        assert.equal(binding.values.size, 1);
        assert.equal(binding.maximum, 0);
        assert.deepEqual(binding.owner.ledger.snapshot().used.slice(0, 4), before);
      } finally { reservation.mock.restore(); }
      return false;
    });
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec('declare -A map; map[seed]=ok; map[key]=sentinel; echo "${map[key]}"');
    assert.equal(checked, true);
    assert.equal(result.stdout, 'sentinel\n');
    assert.equal(result.stderr, '');
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
