# IP-002 keyword object methods

## Baseline and ownership

- Isolated clone: `/Users/kjopek/Workspace/poe-code-safejs-keyword-methods`, `main`, publisher origin `git@github.com:poe-platform/poe-code.git`.
- Clone followed immediately by `git pull --ff-only`; clean base `4358488f9478bcb3c5a89af4fcd61c3cdfcf037f`. No subsequent commits, branches, staging, pulls, pushes, or other-clone writes.
- Read ancestor and root AGENTS instructions. Production write claim: `packages/safejs/src/parse/parser.ts` only; tokenizer and interpreter remain unchanged.
- Publishable tests: new `packages/safejs/src/parse/keyword-methods.test.ts` and the existing `packages/safejs/src/parse/contextual-from-validation.test.ts` IP-002 assertion, updated from known rejection to expected success. All TREE ordinary/escaped-identifier and escaped-separator rejection assertions remain intact.
- Documentation: this plan only. Evidence/preimages/frozen artifacts: ignored `out/safejs-remediation/ip-002/`; its local ignore file avoids any tracked ignore or Git-metadata edits.

## Scope and contract

IP-002 blocks the unchanged original tee/shared-cache workflow at its ordinary `return(value)` method. The local contract documents method shorthand, async methods, and computed properties but does not promise full ECMAScript grammar. This repair accepts IdentifierName method keys while retaining reserved-binding/shorthand restrictions and unsupported generator/accessor method restrictions.

The separately reported async-computed method failure shares the same property-name dispatch and modifier lookahead: async detection only recognizes identifier-like names, occurs after computed-property parsing, and does not pass its modifier to computed or literal methods. Include this related composition repair with separate RED cases and explicit async/computed/literal metadata, native-value, evaluation-order, and invalid-syntax controls. No interpreter feature or source rewriting is required. Escaped `async` modifiers and intervening line breaks must remain rejected; escaped ordinary method names remain legal.

## Work and validation sequence

1. Record pristine base/preimages and install with `env -u TERM SKIP_SYNC_SKILLS=1 npm ci`.
2. Before audit payload reads, bootstrap exactly 38 excluded paths from the original audit's `inventory-verification.json#/archiveReadPolicy/excludedPaths`, exclude all `security/`, and use an explicit nonexcluded allowlist only.
3. Run the unchanged full tee and minimal return-method reduction natively against complete manually authored historical anchors, then current TypeScript SafeJS; retain failures and full outputs.
4. Run new keyword and async-computed regressions RED before production edits. Generalize method-name recognition without relaxing bindings, shorthand data properties, accessors, generators, or TREE import separators.
5. Run focused parser/adjacent runtime, configured/new-test typechecks, ESLint, formatting, and full gates with TERM unset. Build dependencies as required; keep skill syncing disabled.
6. Freeze exact publishables, pristine preimages, command logs, hashes, and limitations for an independent validator. Author GREEN is not publication approval.

## Execution evidence

All attempts, including failures and limits, are retained under the ignored artifact root. The repository-wide full-unit gate completed successfully before freezing; its final result is recorded below.

## Implementation and TDD

- Production changes only `parseObjectProperty` and its existing method/accessor lookahead in `parser.ts`. Keyword tokens followed by a parameter list are IdentifierName method keys, not bindings or literal-value keys. The tokenizer, ordinary keyword data-property handling, and binding/shorthand gates remain unchanged.
- The existing bracket-aware accessor lookahead is shared as `isObjectMethodStart`, allowing the same supported property-name forms after a literal, same-line `async` modifier. Computed and literal methods receive that modifier and start their spans at it. This also retains explicit rejection of getters/setters and generator methods.
- The async-computed observation is included as a separately tested same-grammar companion, not an unrelated feature or silently pending item. Tests cover named, keyword, computed, nested-computed, template-computed, quoted, numeric, and boolean-spelled method names; receiver/await semantics; async AST flags/spans; and one-time computed-key evaluation. Invalid newline/escaped modifiers and malformed computed declarations reject natively and in SafeJS.
- New regression suite: 75 tests, split into 47 keyword-name/binding checks and 28 async-composition/adjacent-restriction checks. All use bounded in-memory code and native VM controls; no test filesystem, LLM, or guest I/O. Existing TREE tests retain all their original ordinary/escaped binding, key, and invalid import-separator assertions; only the formerly expected IP-002 rejection becomes expected success.
- First RED: 45 failed / 89 passed across the new suite and existing TREE validator. One positive control incorrectly awaited a raw sandbox-promise representation on the host; changed the guest program to await its own result, without production changes. The initial failure remains in `red-tests.log`.
- Confirmed RED before production edit: 44 failed / 90 passed (`red-tests-confirmed.log`): 32 keyword-method failures, 11 async-composition/adjacent-diagnostic failures, and the existing IP-002 assertion now expecting success. Bare, nested, and template-computed async methods have explicit failing native-parity tests.
- First production attempt: 5 failed / 129 passed (`green-tests.log`). Literal-spelled keyword method keys (`true`, `false`, `null`, `undefined`, plus async `true`) exposed existing invalid literal-node emission. Corrected method keys to IdentifierName at the parser boundary, without interpreter changes or changes to ordinary data-property handling.
- Final focused GREEN: all 134 tests pass (`green-tests-final.log`). No expected failures or skips were added.

## Commands and gate results

Commands run in the isolated clone. Every test gate unsets TERM and uses snapshot playback/error-on-miss, either explicitly or through the checked default test configuration; unexpected LLM/fetch calls are blocked. Skill syncing remains disabled for installation/build.

| Command                                                                                                                                                                                                                                                                                            | Result                                                                                       | Retained log                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `env -u TERM SKIP_SYNC_SKILLS=1 npm ci`                                                                                                                                                                                                                                                            | exit 0; 548 packages installed                                                               | `npm-ci.log`                                       |
| `env -u TERM node_modules/.bin/vitest run packages/safejs/src/parse/keyword-methods.test.ts packages/safejs/src/parse/contextual-from-validation.test.ts`                                                                                                                                          | confirmed RED exit 1: 44 failed / 90 passed; final GREEN exit 0: 134 passed                  | `red-tests-confirmed.log`, `green-tests-final.log` |
| `env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error node_modules/.bin/vitest run packages/safejs/src/parse packages/safejs/src/run.test.ts packages/safejs/src/interp/interpreter.test.ts packages/safejs/src/interp/generator.test.ts packages/safejs/src/lint.syntax-parity.test.ts` | exit 0: 978 passed / one opt-in fuzz skip, 17 passing files / one skipped                    | `parser-runtime.log`                               |
| `env -u TERM SKIP_SYNC_SKILLS=1 node_modules/.bin/turbo run build --output-logs=errors-only --log-prefix=none --verbosity=0`                                                                                                                                                                       | exit 0: 67 successful tasks, no cached tasks                                                 | `build-dependencies.log`                           |
| `env -u TERM npm run lint:types`                                                                                                                                                                                                                                                                   | exit 0 after dependency builds                                                               | `root-types.log`                                   |
| `env -u TERM node_modules/.bin/tsc --noEmit -p packages/safejs/tsconfig.json`                                                                                                                                                                                                                      | exit 0                                                                                       | `package-types.log`                                |
| `env -u TERM node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/safejs/src/parse/keyword-methods.test.ts packages/safejs/src/parse/contextual-from-validation.test.ts`                                | exit 0                                                                                       | `test-types.log`                                   |
| `env -u TERM npm run lint:eslint`                                                                                                                                                                                                                                                                  | exit 0, entire repository                                                                    | `full-eslint.log`                                  |
| `env -u TERM node_modules/.bin/eslint packages/safejs/src/parse/parser.ts packages/safejs/src/parse/keyword-methods.test.ts packages/safejs/src/parse/contextual-from-validation.test.ts`                                                                                                          | exit 0                                                                                       | `scoped-eslint.log`                                |
| `env -u TERM node_modules/.bin/prettier --check packages/safejs/src/parse/parser.ts packages/safejs/src/parse/keyword-methods.test.ts packages/safejs/src/parse/contextual-from-validation.test.ts`                                                                                                | exit 0; plan formatting also passes                                                          | `scoped-format.log`                                |
| `env -u TERM SKIP_SYNC_SKILLS=1 POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error npm run test:unit`                                                                                                                                                                                              | exit 0: 21,935 passed / 41 existing skips; 943 passing files / three skipped; 255.06 seconds | `full-unit.log`                                    |

### Unchanged original workflow results

`red-original.json` and `green-original.json` retain original source bytes/hashes, the exact three-file execution allowlist, all 38 excluded paths, full independent historical anchors, complete fresh native/SafeJS output, process stdout/stderr/status, and budget usage. The only other original audit payload reads were explicitly allowlisted `keyword-method-review/REPORT.md` and `keyword-method-review/contract-classification.json`; no recursive audit search or excluded reads/hashes/executions occurred.

Both native originals pass complete manually authored anchors before SafeJS begins. Before the fix, full tee rejects at line 54 column 5 and the reduction at line 5 column 3, each with zero steps. After the fix, full tee passes all four schedules and 20 operations with identical trees of returned data, cache states, ordered traces, shared-identity checks, and final states (4,076 steps); the unchanged reduction exactly matches its complete native value (28 steps). No source is quoted, renamed, or rewritten to achieve these matches.

### Limits and preservation

- This is a method-grammar repair, not full ECMAScript support. Accessor/generator shorthand, reserved bindings, and illegal keyword shorthand remain rejected. No interpreter, tokenizer, README, SDK/CLI, or unrelated core edits.
- Installation printed 10 dependency-vulnerability advisories; no security investigation, audit fix, dependency-version change, or lockfile mutation was performed. Existing standard repository regression tests are gates, not new security probes or archived audit execution.
- Dependency build generates four untracked JetBrains Mono font assets under `packages/terminal-pilot/assets/`; these build outputs are explicitly excluded from publishables and retained locally. No visual CLI behavior changes, so no screenshot is generated.
- Pristine preimages in `preimages/` were hashed against `baseline.json` and match byte-for-byte. Independent validation is still required; no release/publish/commit/staging/branch action is authorized or performed.
- Final plan formatting required a whitespace-only `apply_patch` pass after adding the command table. No production/test file changed after the successful full-unit gate.

## Frozen handoff

Freeze exactly four publishables: `packages/safejs/src/parse/parser.ts`, `packages/safejs/src/parse/keyword-methods.test.ts`, `packages/safejs/src/parse/contextual-from-validation.test.ts`, and this plan. The ignored artifact root contains exact payload copies, base preimages (or explicit base absence for new paths), a complete patch, a SHA-256 manifest, logs, and full original-case evidence. The manifest excludes its own hash; its digest is reported separately at handoff. Validation should verify the base/preimage hashes and frozen payload hashes before exercising the isolated clone or transplanting changes.

## Original workflow reproduction

Execute this unchanged command with `PHASE=red` before the parser patch and `PHASE=green` afterward. It reads only the named allowlist, checks complete manually authored anchors before SafeJS, and retains full source bytes, expected/actual outputs, errors, stdout/stderr, timings, and budget usage. Source is unchanged; native runs it as an async function body and SafeJS uses the current TypeScript API. No module or guest I/O capability is supplied.

```bash
env -u TERM node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
const root = '/Users/kjopek/Workspace/poe-code';
const audit = root + '/out/safejs-audit-2026-08-27';
const metadata = JSON.parse(readFileSync(audit + '/inventory-verification.json', 'utf8'));
const excludedPaths = metadata.archiveReadPolicy.excludedPaths;
const excluded = new Set(excludedPaths.map(file => resolve(root, file)));
if (excluded.size !== 38) throw Error('Expected exact 38 archive exclusions');
const allowlist = ['iterable-pipelines/examples/03-tee-shared-cache.js', 'iterable-pipelines/reductions/07-return-method.js', 'keyword-method-review/expected.json'];
const sources = new Map();
for (const relative of allowlist) {
  const file = resolve(audit, relative);
  if (!file.startsWith(audit + '/') || excluded.has(file) || file.startsWith(audit + '/security/')) throw Error('Excluded path');
  sources.set(relative, readFileSync(file, 'utf8'));
}
const oracle = JSON.parse(sources.get(allowlist[2]));
const cases = [{ id: 'tee-original', file: allowlist[0], expected: oracle.tee }, { id: 'return-method-original', file: allowlist[1], expected: oracle.control }];
const childProgram = `import { readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(0, 'utf8'));
let budget;
try {
  let value;
  if (input.mode === 'native') {
    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
    value = await new AsyncFunction(input.source)();
  } else {
    const { run } = await import('./packages/safejs/src/run.ts');
    const { Budget } = await import('./packages/safejs/src/interp/budget.ts');
    budget = new Budget({ maxSteps: 200000, maxCallDepth: 96, stringLength: 65536, arrayLength: 2048, dataSize: 1048576, deadline: Date.now() + 4000 });
    const result = await run(input.source, { modules: {}, budget, randomSeed: 827 });
    if (!result.ok) throw result.error;
    value = result.returnValue;
  }
  console.log(JSON.stringify({ ok: true, value, ...(budget ? { steps: budget.stepsUsed } : {}) }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: { name: error.name, message: error.message, kind: error.kind, span: error.span }, ...(budget ? { steps: budget.stepsUsed } : {}) }));
}`;
const records = [];
const native = new Map();
for (const mode of ['native', 'safe']) {
  for (const item of cases) {
    const source = sources.get(item.file);
    const startedAt = new Date().toISOString();
    const child = spawnSync(process.execPath, ['--max-old-space-size=192', ...(mode === 'safe' ? ['--import', 'tsx'] : []), '--input-type=module', '-e', childProgram], { cwd: process.cwd(), env: { PATH: process.env.PATH, TSX_DISABLE_CACHE: '1' }, input: JSON.stringify({ mode, source }), encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1048576 });
    const output = child.status === 0 ? JSON.parse(child.stdout) : null;
    const matchesExpected = output?.ok === true && isDeepStrictEqual(output.value, item.expected);
    records.push({ id: item.id, mode, startedAt, finishedAt: new Date().toISOString(), status: child.status, signal: child.signal, processError: child.error?.message, stdout: child.stdout, stderr: child.stderr, output, expected: item.expected, matchesExpected });
    if (child.status !== 0 || child.signal || child.error || child.stderr) throw Error(JSON.stringify(records));
    if (mode === 'native') {
      if (!matchesExpected) throw Error('Native independent anchor mismatch: ' + item.id);
      native.set(item.id, output.value);
    }
    console.log(JSON.stringify({ id: item.id, mode, output, matchesExpected, matchesNative: isDeepStrictEqual(output?.value, native.get(item.id)) }));
  }
}
const evidence = { phase: process.env.PHASE, excludedPaths, entireSecurityDirectoryExcluded: true, allowlist, sources: [...sources].map(([file, source]) => ({ file, source, sha256: createHash('sha256').update(source).digest('hex') })), childProgram, records };
if (!['red', 'green'].includes(evidence.phase)) throw Error('Expected PHASE=red or green');
const file = 'out/safejs-remediation/ip-002/' + evidence.phase + '-original.json';
const patch = '*** Begin Patch\n*** Add File: ' + file + '\n' + JSON.stringify(evidence, null, 2).split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch\n';
const applied = spawnSync('apply_patch', [patch], { encoding: 'utf8' });
if (applied.status !== 0) throw Error(applied.stderr);
console.log(applied.stdout);
if (evidence.phase === 'green' && records.some(record => !record.matchesExpected)) throw Error('GREEN full-output mismatch');
NODE
```
