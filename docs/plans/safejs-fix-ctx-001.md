# CTX-001 callback receiver fix

## Isolation and scope

- Author: delegated CTX001 functional worker; independent validation remains separate.
- Date: 2026-08-29. Fresh main clone of the publish clone's origin; first operation
  after cloning was `git pull --ff-only origin main` (already up to date).
- Base: `33c73a21fb01875b0e2297ccac955974a0889991`.
- Only this clone may be written. No commits, pushes, new branches, README changes,
  guest IO, real LLM calls, or security research.
- Bootstrap the 38 exclusions from the original inventory-verification metadata,
  plus all of its security directory, before any original functional artifact reads.
  Read only the explicit allowlist recorded in the ignored evidence directory.
  Original artifacts remain immutable; copy and hash only allowed functional inputs.
- Preserve LANG-01 read-only nested callbacks and array metadata as separate issues;
  do not broaden this fix or claim those issues resolved.

## Steps

1. Record base, exclusions, exact functional input copies, and source preimages.
2. Add fast pure native-comparison tests and observe failure before production edits.
3. Forward callback receivers through shared dispatch using actual argument positions.
   Cover array iteration/search/flatMap, Map/Set forEach, and Array.from; leave
   reduce/reduceRight initialValue and sort comparators without a receiver.
   Preserve arrow lexical this and pre-bound function receivers.
4. Run focused and broader tests, package/root types, lint, and changed-file format.
   Use `SKIP_SYNC_SKILLS=1 npm ci` and needed builds, and `env -u TERM` for full tests.
5. Compare all three original CTX-001 sources unchanged against native execution and
   manual expected full outputs; exercise completed replay and active checkpoints.
6. Freeze candidate source/tests/plan, original copies, preimages, evidence, and hash
   manifest under ignored `out/safejs-remediation/ctx-001/` for independent validation.

## Contract and implementation boundary

The installed source already supports ordinary this, lexical arrow this, and bind.
The native ECMAScript callback contract supplies thisArg in argument 2 for array
iteration and Map/Set forEach, and argument 3 for Array.from. Reducer argument 2 is
initialValue, not thisArg. Shared array callback dispatch must distinguish these
without rewriting closure binding semantics. Reference: ECMA-262 indexed collections,
sections Array.from and Array.prototype iteration methods; keyed collections forEach.

These are synthetic API controls, not OSS algorithms or substantial workflows.
No CLI visual behavior changes are intended; screenshots are not applicable.

## Validation record

### TDD and functional checks

- Before production changes, the new 135-test native comparison matrix produced
  78 failures and 57 passes in 294 ms of test time. All 78 failures concern the
  omitted supplied receiver; omitted/undefined, arrow, bound, reducer, and comparator
  controls already passed. Evidence: `tdd-red.log`.
- The initial fix passed all 135 tests. Six pure active-checkpoint tests were then
  added, and ordinary receiver cases gained completed-snapshot replay checks.
- Final focused suite: 141 passing tests (292 ms test time), comprising 130 matrix
  cases across 13 callback APIs, six active-checkpoint cases, two reducers, two
  comparators, and one bound-argument replay case. There are 14 completed replay
  checks plus six active checkpoint/restore checks. Evidence: `focused-final.log`.
- Checkpoint tests suspend only on in-memory sandbox promises. They cover ordinary,
  lexical arrow, and bound receivers for both map and Array.from. No filesystem,
  guest IO, real host service, or LLM is involved.
- Test-only typechecking initially found `Promise<void>` incompatible with
  `Promise<SandboxValue>` in the checkpoint fixture. Explicit `Promise<undefined>`
  and `Promise.resolve(undefined)` fixed the fixture; test types and all 141 focused
  cases then passed. No production adjustment was needed.
- All three allowlisted original CTX-001 sources were executed byte-for-byte without
  guest rewrites: map-thisarg, foreach-thisarg, and map-explicit-call. Each passed two
  native executions, two SafeJS executions, and two completed replays: 18/18 checks.
  Full results match the original manual expectations, including receiver/source
  identity booleans, indices, unchanged inputs/context, and positive zero.
- Native comparison imports unchanged source as a data-URL ESM module; SafeJS uses
  `run(source, { entryPointArgs: [] })`. `structuredClone` normalizes only the
  null-prototype transport records before strict full-result comparison. An initial
  unnormalized assertion stopped on prototype differences, not incorrect values;
  the corrected comparison was rerun in full. Evidence: `original-comparisons.json`.
- A separate pure read-only nested-map control still rejects with `SandboxError`
  code `reentry`, while native returns `[[1, 2], [1, 2]]`. This explicitly preserves
  the separate LANG-01 boundary. Evidence: `lang01-separate-control.json`.
  Array metadata behavior was not altered or claimed fixed.

### Commands and broader verification

All commands run in this isolated clone. Evidence lives under
`out/safejs-remediation/ctx-001/`. Full tests unset TERM. Snapshot mode is playback;
the initial runs supplied the unused `POE_SNAPSHOT_ON_MISS=error`, but the actual
`POE_SNAPSHOT_MISS` was confirmed unset and therefore defaulted to error. Final
commands explicitly use `POE_SNAPSHOT_MISS=error`.

- `SKIP_SYNC_SKILLS=1 npm ci`: passed; lockfile unchanged.
- `SKIP_SYNC_SKILLS=1 npm exec turbo run build -- --output-logs=errors-only`:
  67/67 build tasks passed, no cache hits.
- `env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_ON_MISS=error npm run test:unit -- packages/safejs/src packages/safejs/test`:
  147 files passed, one skipped; 4,308 tests passed, 39 skipped (4,347 total).
- `env -u TERM SKIP_SYNC_SKILLS=1 POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_ON_MISS=error npm run test:unit`:
  937 files passed, three skipped; 21,693 tests passed, 41 skipped (21,734 total).
- `env -u TERM SKIP_SYNC_SKILLS=1 POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error npm run test:unit -- packages/safejs/src/interp/methods/callback-this.test.ts`:
  final focused 141/141 pass.
- `npm run lint:types`, `node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`,
  and `node_modules/.bin/tsc -p out/safejs-remediation/ctx-001/tsconfig.tests.json`:
  root, package, and new-test typechecks pass.
- `npm run lint:eslint`: full-repository ESLint passes. Changed-source/test ESLint
  was rerun after the test type correction and passes.
- Prettier check on all seven candidate files and `git diff --check`: pass.
- `env -u TERM SKIP_SYNC_SKILLS=1 POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error npm run test:unit`:
  the final complete suite on exact final source/test bytes also passes: 937 files
  passed, three skipped; 21,693 tests passed, 41 skipped (21,734 total), 281.84 seconds.
  Evidence: `full-tests-final.log`.

### Candidate files and handoff

Only these seven files form the candidate:

1. `packages/safejs/src/interp/methods/array.ts`
2. `packages/safejs/src/interp/methods/map.ts`
3. `packages/safejs/src/interp/methods/set.ts`
4. `packages/safejs/src/interp/globals/object-array.ts`
5. `packages/safejs/src/interp/interpreter.ts`
6. `packages/safejs/src/interp/methods/callback-this.test.ts`
7. `docs/plans/safejs-fix-ctx-001.md`

The array receiver is threaded through existing iteration helpers to shared
`callArrayCallback` dispatch, then the existing interpreter invocation context.
Map/Set dispatch forwards argument 2; Array.from forwards argument 3. Reducer and
comparator dispatch is deliberately unchanged. There are no new binding wrappers,
method-specific emulation, closure implementation changes, or collection-lock changes.

Preimages preserve all five production files; the test and plan are recorded as
absent at base. Handoff includes candidate copies, a reverse-checked patch, exact
evidence, and a SHA-256 manifest, protected read-only with macOS immutable flags.
The manifest records every frozen file; its own digest is in `hash-manifest.sha256`.
Author status: ready for independent validation. No commit or push occurs.
Build/test execution left untracked `packages/terminal-pilot/assets/`; it is not part of
this candidate and is left alone. `out/safejs-remediation/` is locally ignored through
`.git/info/exclude`, with no tracked ignore-file change.

Limits: synthetic controls only; no substantial workflow or OSS algorithm is
claimed. Existing skipped tests remain skipped. No CLI visual behavior changed,
so screenshots are not applicable. No E2E/real-LLM execution or security research
was performed. Excluded archive reads/hashes/executions and original writes are zero.
This is author verification, not independent validation or publication approval.
