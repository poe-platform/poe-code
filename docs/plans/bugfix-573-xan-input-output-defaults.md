# Issue #573: source-only xan input/output defaults

## Authorization and scope

- Date: September 4, 2026. Issue author confirmed previously through `gh`:
  `kamilio` (Kamil Jopek), poe-platform/poe-code issue #573.
- Root explicitly authorizes only this plan and
  `packages/safe-bash/src/commands/xan/options.ts`.
- Change the input and output defaults from 268435456 to **16000000 bytes**
  each: decimal 16 MB, not 16 MiB, consistent with the requested #572 policy.
- Preserve every other default, hard ceiling, trusted override, and validation
  rule. Do not integrate xan into public exports, default registration, or builds.
- Applicable instructions are root `AGENTS.md` and
  `packages/safe-bash/AGENTS.md`; no deeper instructions apply to these files.
  The package's build rules prohibit raw-glob/transitive-import bypass of the
  guarded build and require separate authorization to admit experimental source.
  They do not prohibit this explicitly authorized, manual source-import profile.
  No guarded build, test, lint, typecheck, or admission route is invoked or changed.
- Held source/evidence boundaries, inventories, exclusions, historical files,
  README files, existing logs, and code history remain untouched by this task.
  No canonical test importing held source and no maintained QA script is added.

## TDD and manual QA procedure

This markdown is the QA plan, executed by an agent. The following single shell
block is the exact reproducible source-only profile. Run it from
`/home/kjopek/project/poe-code` with escalation, first before the source edit
(RED), then unchanged after the source edit (GREEN). Expected RED: only the two
literal-default assertions fail. Numeric boundary and tiny-command controls must
pass in both phases. The process exits 1 if any assertion fails, otherwise 0.

The block can be copied directly, or executed without writing a script using:
`set -o pipefail; awk '$0 == "```bash" { active = 1; next } active && $0 == "```" { exit } active { print }' docs/plans/bugfix-573-xan-input-output-defaults.md | bash`

Profile: Node 22 from `/tmp/kamilio-toolchain.path`; private `TMPDIR` from
`/tmp/kamilio-561-562-tmp.path`; `TSX_DISABLE_CACHE=1`; `NO_COLOR` unset; Git-local
variables listed by `git rev-parse --local-env-vars` cleared only in the child
shell. Git discovery here is read-only; no Git mutation is authorized. Imports
are current source `.ts` entrypoints through `tsx`, not built/public xan exports.
Only numeric ledgers and four-byte CSV streams are exercised. All command I/O is
in memory; the filesystem stub rejects access. No payload-sized allocation,
timing, RSS, stress, build, broad gate, or filesystem-output experiment is used.

```bash
set -e
cd /home/kjopek/project/poe-code
TOOLCHAIN=$(cat /tmp/kamilio-toolchain.path)
export TMPDIR=$(cat /tmp/kamilio-561-562-tmp.path)
export PATH="$TOOLCHAIN/bin:$PATH"
export TSX_DISABLE_CACHE=1
unset NO_COLOR
for variable in $(git rev-parse --local-env-vars); do unset "$variable"; done
"$TOOLCHAIN/bin/node" --import tsx --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defaultLimits, hardLimits, validateOptions } from './packages/safe-bash/src/commands/xan/options.ts';
import { Budget, LimitError } from './packages/safe-bash/src/commands/xan/budget.ts';
import { createXanCommand } from './packages/safe-bash/src/commands/xan/index.ts';

assert.equal(process.versions.node.split('.')[0], '22');
assert.equal(process.env.TSX_DISABLE_CACHE, '1');
assert.equal(Object.hasOwn(process.env, 'NO_COLOR'), false);
const sourcePath = 'packages/safe-bash/src/commands/xan/options.ts';
console.log(JSON.stringify({
  node: process.version,
  tmpdir: process.env.TMPDIR,
  sourceSha256: createHash('sha256').update(readFileSync(sourcePath)).digest('hex'),
}));
const results = [];
async function check(name, action) {
  try {
    await action();
    results.push({ name, pass: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, pass: false });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

await check('input default is decimal 16000000', () => {
  assert.equal(defaultLimits.maxInputBytes, 16000000);
  assert.equal(validateOptions().limits.maxInputBytes, 16000000);
});
await check('output default is decimal 16000000', () => {
  assert.equal(defaultLimits.maxOutputBytes, 16000000);
  assert.equal(validateOptions().limits.maxOutputBytes, 16000000);
});
await check('other defaults and frozen option semantics remain unchanged', () => {
  const { maxInputBytes, maxOutputBytes, ...otherDefaults } = defaultLimits;
  assert.deepEqual(otherDefaults, {
    maxArgs: 128, maxArgumentBytes: 65536, maxInputFiles: 16,
    maxChunks: 262144, maxChunkBytes: 8388608,
    maxRecordBytes: 8388608, maxCellBytes: 4194304, maxColumns: 16384,
    maxRecords: 1000000, maxSelectorBytes: 16384, maxSelectorNodes: 4096,
    maxSelectorDepth: 2, maxSelectedColumns: 16384, maxLastRows: 4096,
    maxWork: 1000000000, maxRetainedBytes: 33554432,
  });
  assert.deepEqual(validateOptions(), { limits: defaultLimits, replace: false });
  assert.ok(Object.isFrozen(defaultLimits));
  assert.ok(Object.isFrozen(validateOptions().limits));
});
await check('all hard ceilings remain unchanged', () => {
  assert.deepEqual(hardLimits, {
    maxArgs: 4096, maxArgumentBytes: 1048576, maxInputFiles: 256,
    maxInputBytes: 4294967296, maxChunks: 4194304, maxChunkBytes: 67108864,
    maxRecordBytes: 67108864, maxCellBytes: 33554432, maxColumns: 65536,
    maxRecords: 16000000, maxSelectorBytes: 262144, maxSelectorNodes: 65536,
    maxSelectorDepth: 2, maxSelectedColumns: 65536, maxLastRows: 65536,
    maxWork: 16000000000, maxOutputBytes: 4294967296, maxRetainedBytes: 268435456,
  });
  assert.ok(Object.isFrozen(hardLimits));
});
for (const name of ['maxInputBytes', 'maxOutputBytes']) {
  await check(`${name}: exact, +1, and cumulative numeric admission`, () => {
    const limits = validateOptions().limits;
    const limit = limits[name];
    const budget = new Budget(limits, new AbortController().signal);
    const isLimit = error => error instanceof LimitError && error.limit === name;
    budget.bound(name, limit);
    assert.throws(() => budget.bound(name, limit + 1), isLimit);
    assert.throws(() => budget.add(name, limit + 1), isLimit);
    assert.equal(budget.totals.has(name), false);
    budget.add(name, limit - 1);
    budget.add(name, 1);
    assert.equal(budget.totals.get(name), limit);
    assert.throws(() => budget.add(name, 1), isLimit);
    assert.equal(budget.totals.get(name), limit);
  });
}
await check('trusted overrides admit larger values and preserve hard ceilings', () => {
  for (const name of ['maxInputBytes', 'maxOutputBytes']) {
    for (const value of [16000001, 268435456, hardLimits[name]]) {
      const limits = validateOptions({ limits: { [name]: value } }).limits;
      assert.deepEqual(limits, { ...defaultLimits, [name]: value });
      assert.ok(Object.isFrozen(limits));
      const budget = new Budget(limits, new AbortController().signal);
      budget.add(name, value);
      assert.equal(budget.totals.get(name), value);
      assert.throws(() => budget.add(name, 1), error => error instanceof LimitError && error.limit === name);
    }
    for (const value of [0, -1, 1.5, NaN, Infinity, hardLimits[name] + 1]) {
      assert.throws(() => validateOptions({ limits: { [name]: value } }), RangeError);
    }
  }
});

async function tiny(limits) {
  const stdout = [], stderr = [], cleanups = [];
  const result = await createXanCommand({ limits }).execute({
    command: 'xan', args: ['count'], cwd: '/', env: {},
    fs: new Proxy({}, { get() { throw new Error('unexpected filesystem access'); } }),
    stdin: { async *[Symbol.asyncIterator]() {
      yield new Uint8Array([97, 10]);
      yield new Uint8Array([48, 10]);
    } },
    stdinIsDefault: false,
    stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
    signal: new AbortController().signal,
    registerCleanup(cleanup) { cleanups.push(cleanup); },
  });
  await Promise.all(cleanups.map(cleanup => cleanup()));
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}
await check('four-byte CSV: default, exact input, cumulative refusal, larger override', async () => {
  const success = { exitCode: 0, stdout: '1\n', stderr: '' };
  assert.deepEqual(await tiny(undefined), success);
  assert.deepEqual(await tiny({ maxInputBytes: 4 }), success);
  assert.deepEqual(await tiny({ maxInputBytes: 3 }), {
    exitCode: 1, stdout: '', stderr: 'xan count: maxInputBytes limit exceeded\n',
  });
  assert.deepEqual(await tiny({ maxInputBytes: 268435456, maxOutputBytes: 268435456 }), success);
});
await check('four-byte CSV: exact output and exhausted-output diagnostic control', async () => {
  assert.deepEqual(await tiny({ maxInputBytes: 4, maxOutputBytes: 2 }), {
    exitCode: 0, stdout: '1\n', stderr: '',
  });
  assert.deepEqual(await tiny({ maxInputBytes: 4, maxOutputBytes: 1 }), {
    exitCode: 1, stdout: '', stderr: '',
  });
});
const failed = results.filter(result => !result.pass);
console.log(JSON.stringify({ checks: results.length, passed: results.length - failed.length, failed: failed.map(result => result.name) }));
process.exitCode = failed.length ? 1 : 0;
NODE
```

## Execution evidence

- Before-source SHA-256:
  `b8048c66111f47c6b56c1cf420eee20512c0ef17d5055b70fca2785976f1f074`.
- Source dependency observations before the probe: `budget.ts` SHA-256
  `a8fcd8854c330b27f57833b3f185013b5af4321690be8ab5270dfe1cb5c368df`;
  `index.ts` SHA-256
  `fb664e5a432222c0d79765507da65712a3412a719390a01741b1aa730d4260e9`.
- RED executed before the source edit on Node v22.22.0, using private TMPDIR
  `/var/tmp/poe-code-kamilio-561-562.dFKZCV` and toolchain root
  `/var/tmp/poe-code-kamilio-toolchain.GzqQj3`. Exit status **1**: 9 checks,
  7 passed, exactly 2 failed: `input default is decimal 16000000` and
  `output default is decimal 16000000`. Both reported actual `268435456`
  versus expected `16000000`. The source hash matched the before-source hash.
- GREEN executed using the identical command and environment after changing only
  the two source literals. Exit status **0**: `{"checks":9,"passed":9,"failed":[]}`.
  Both decimal-default assertions, all unchanged-default/ceiling checks, both
  numeric exact/+1/cumulative controls, trusted overrides, and all six four-byte
  CSV invocations passed. No timing or RSS measurements were collected.
- Final source SHA-256:
  `20e40e574b9cdb9fe6623dfe868a6401abde7c4db8407df60eb62726814f7518`.
- Final freeze uses `sha256sum packages/safe-bash/src/commands/xan/options.ts docs/plans/bugfix-573-xan-input-output-defaults.md`.
  Report both hashes in the handoff after the last edit; the plan's own final
  digest is external to avoid a self-referential hash. This freezes two owned
  files only, not the whole concurrent worktree or transitive dependencies.

The following final, read-only source-delta assertion reverses the two authorized
tokens **in memory only** and requires the original source hash. It also requires
the observed GREEN hash, then hashes both final files. Run after the final plan
edit; this is not a rewrite of the source or a Git operation on tracked content.

```bash
set -e
cd /home/kjopek/project/poe-code
TOOLCHAIN=$(cat /tmp/kamilio-toolchain.path)
export TMPDIR=$(cat /tmp/kamilio-561-562-tmp.path)
export PATH="$TOOLCHAIN/bin:$PATH"
export TSX_DISABLE_CACHE=1
unset NO_COLOR
for variable in $(git rev-parse --local-env-vars); do unset "$variable"; done
"$TOOLCHAIN/bin/node" --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
assert.equal(process.versions.node.split('.')[0], '22');
const source = readFileSync('packages/safe-bash/src/commands/xan/options.ts', 'utf8');
const original = source
  .replace('maxInputBytes: 16000000,', 'maxInputBytes: 268435456,')
  .replace('maxOutputBytes: 16000000,', 'maxOutputBytes: 268435456,');
assert.equal(createHash('sha256').update(original).digest('hex'), 'b8048c66111f47c6b56c1cf420eee20512c0ef17d5055b70fca2785976f1f074');
assert.equal(createHash('sha256').update(source).digest('hex'), '20e40e574b9cdb9fe6623dfe868a6401abde7c4db8407df60eb62726814f7518');
console.log('PASS exact two-token source delta and GREEN source hash');
NODE
sha256sum packages/safe-bash/src/commands/xan/options.ts docs/plans/bugfix-573-xan-input-output-defaults.md
```

## Changed behavior and qualification limits

- Default invocations consuming more than 16000000 input bytes or producing
  more than 16000000 accounted output bytes now refuse earlier. These are
  cumulative logical invocation budgets, not a shared shell budget or file-size
  preflight. Whole delivered chunks are admitted before per-byte scanning.
- Explicit trusted overrides still allow larger limits up to existing ceilings.
  Short-reading commands need not consume or reject an entire oversized file.
- Earlier streamed output can remain visible on later refusal. Exhausted output
  budget can suppress diagnostics; the tiny control preserves that behavior.
- Other work/record/chunk/retention constraints may refuse first. The unchanged
  33554432-byte retention ledger is not an RSS bound. No timing, CPU, RSS,
  provider-allocation, or isolate-safety claim is established.
- This is **manual source-only qualification**, not CI, build, public xan,
  packed-consumer, release, or whole-worktree qualification. The README's old
  numeric table is intentionally not edited under the explicit restriction.
- No commits, pushes, releases, builds, broad tests, or maintained gate changes.
