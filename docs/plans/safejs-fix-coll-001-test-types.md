# COLL-001 validation fixture typing repair

## Scope and isolation

Author repair only, followed by a separate independent validator. The isolated clone is `/Users/kjopek/Workspace/poe-code-safejs-collection-test-types`, on `main`, base `4358488f9478bcb3c5a89af4fcd61c3cdfcf037f`. It was cloned from the publisher's configured origin `git@github.com:poe-platform/poe-code.git`, then immediately pulled with `git pull --ff-only origin main` before reading repository files. The pull was already up to date and the starting worktree was clean. Ancestor and applicable root instructions were read.

Only `packages/safejs/src/interp/globals/collections-iteration-validation.test.ts` may change as code. This plan and new evidence/captures under `out/safejs-remediation/coll-001-test-types/` are owned by this repair. No production changes, README edits, inline comments, suppression directives, broad casts, skipped tests, commits, pushes, or feature branches. No writes to original, shared, integrated, or publisher clones. No original audit payloads or security research are needed.

## Reported defect

The OBJ-001 merged validator retained three TS2345 diagnostics at lines 92, 95, and 120 of the unchanged COLL validator: `Promise<void>` is not assignable to `Promise<SandboxValue>`. These are defects in this validator's own newly authored fixtures, not a waived pre-existing issue. The historical twelve-root compiler command and its failed output are retained as metadata in this repair's evidence.

## Agent-executed TDD and QA procedure

1. Install dependencies only inside this clone with lifecycle scripts disabled. Build required local declarations with `env -u TERM`; do not borrow or link another clone's writable dependencies or dist.
2. Before editing the test, reproduce the three diagnostics using the historical strict compiler options and explicit test roots. This fresh main does not contain the two unmerged OBJ test files from the historical twelve-root command; preserve that environmental difference rather than dropping roots silently. Any historical fixture overlay must be in memory, hash-verified from frozen captures, and disclosed separately from the actual-main check.
3. Correct only the promise fixture's value/function types. Keep every assertion, native oracle, guest source string, checkpoint control, and test case unchanged. No production complexity may be added for typing tests.
4. Run the same compiler checks after repair and record the exact three-to-zero result. Compare the before/after assertion and fixture source inventory and emitted JavaScript to establish the limited runtime-equivalent change.
5. Run the 136 COLL runtime tests, relevant adjacent tests, configured SafeJS/root typechecks, the historical supplemental strict test-root check, ESLint, Prettier, and diff hygiene. Retain every failure and retry result; no original audit replay or unrelated matrix expansion.
6. Freeze the exact repaired test and this plan with current/base preimages, bytes, SHA-256, full commands/results, and an explicit `AWAITING_INDEPENDENT_VALIDATION` handoff. No publication is performed by this author.

## Repair and compile TDD

The defect was reproduced before editing the test. The real compile-red run exited 1 with exactly three TS2345 diagnostics at lines 92, 95, and 120. All three identify `Promise<void>` passed to `createSandboxPromise`, whose input is `Promise<SandboxValue>`. Runtime `undefined` is a sandbox value; TypeScript's `void` is not a substitute for the concrete `undefined` type.

The repair changes five lines inside `verifyCheckpoint`:

- Type the release callback as `(value: undefined) => void`.
- Type the gate as `Promise<undefined>`.
- Pass `undefined` explicitly to both `Promise.resolve` calls and to the stored release callback.

There are no casts, suppression directives, extra wrappers, skipped tests, production edits, or changes to assertion/native/guest code. The same strict compiler body, options, twelve test roots, and in-memory fixture setup then exit 0 with **zero diagnostics**. The full red/green argv and stdin are identical, retained in `compile-red-diagnostics.json` and `compile-green.json`.

### Historical roots and isolated-main coverage

This fresh publisher-origin main does not contain the two unmerged OBJ-001 test files present in the original supplemental check. Dropping them would not reproduce that twelve-root check. Their exact frozen candidate bytes were therefore verified against the earlier handoff manifest and retained as non-executable JSON fixture data in `historical-test-roots.json`. Only these two absent paths are exposed to TypeScript's filesystem in memory; no file under `packages/` is added, no current-main file is replaced, and no OBJ production implementation is substituted. The original compiler body is executed unchanged after its two imports are supplied by the wrapper.

In addition, a separate **actual-main strict check** compiles all source and all ten present historical test roots with no virtual files or compiler overrides: **zero diagnostics**. It is explicitly distinct from, and does not replace, the twelve-root historical command. If an independent validator's base now includes the two OBJ files, it must compile those actual files without the absent-root overlay.

The historical command's three diagnostics remain preserved. The initial new driver attempt had a string-escaping syntax error before TypeScript ran; `compile-red.json` retains that failure. The corrected driver is `compile-command-corrected.json`; `compile-red-diagnostics.json` is the authoritative compile-red result. No driver failure is misclassified as a test-type diagnostic.

### Exact three-to-zero replay command

The following repeats the exact recorded argv/stdin used for both the real compile-red and compile-green runs. The JSON contains the entire historical compiler body, all twelve full test paths, and the hash-checking absent-fixture wrapper; it is execution metadata, not an executable QA file.

```sh
env -u TERM node --input-type=module <<'NODE'
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const command = JSON.parse(fs.readFileSync('out/safejs-remediation/coll-001-test-types/compile-command-corrected.json', 'utf8'));
const result = spawnSync(command.argv[0], command.argv.slice(1), {
  input: command.stdin,
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exitCode = result.status ?? 1;
NODE
```

Before repair: `Explicit test roots: 12; diagnostics: 3`, exit 1. After repair: `Explicit test roots: 12; diagnostics: 0`, exit 0. Both runs verify that both frozen absent OBJ roots were actually read by the compiler.

## Assertion and runtime preservation

`assertion-preservation.json` compares the repaired file with its exact base-HEAD bytes using TypeScript's parser:

- All **28 assertion call nodes** have identical source text.
- All **145 string/template nodes**, including guest sources and expected-value literals, have identical source text.
- All **four native `new Function` oracle constructions** have identical source text.
- All **17 top-level statements outside `verifyCheckpoint`** are identical, preserving every test group, case matrix, and control.
- Emitted JavaScript differs only by three explicit `undefined` arguments: two native `Promise.resolve` calls and the saved native promise resolver. Normalizing those three arguments back to their original omitted-argument form makes the entire emitted JavaScript identical. Raw emitted JavaScript is not claimed byte-identical; both forms already fulfill with `undefined`.

The test changes from SHA-256 `9eb79e3bd34244fc59f90840c3d8dd49ba60165efe1dd65a4677c60233086814` to `c2b42637ba31e60a4543129d2278cac308b61eaf696297d9811886378435f611`. The actual diff is five substitutions confined to the promise helper. No production file differs from base HEAD.

## Executed validation

All commands run inside the new isolated clone with `TERM` removed. Full output and nonzero exit statuses are preserved under `out/safejs-remediation/coll-001-test-types/`.

```sh
env -u TERM npm ci --ignore-scripts
env -u TERM ./node_modules/.bin/turbo run build --filter=@poe-code/safejs --output-logs=errors-only
env -u TERM ./node_modules/.bin/vitest run packages/safejs/src/interp/globals/collections-iteration-validation.test.ts packages/safejs/src/interp/globals/collections-iteration.test.ts packages/safejs/src/interp/globals/collections.test.ts packages/safejs/src/interp/interpreter.test.ts packages/safejs/src/run.random.test.ts packages/safejs/src/run.snapshot.test.ts packages/safejs/src/run.completed-replay.test.ts packages/safejs/test/integration/snapshot-roundtrip.test.ts --reporter=default --reporter=json --outputFile=out/safejs-remediation/coll-001-test-types/runtime.json
env -u TERM ./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
env -u TERM npm run lint:types
env -u TERM ./node_modules/.bin/eslint packages/safejs/src/interp/globals/collections-iteration-validation.test.ts
env -u TERM ./node_modules/.bin/prettier --check packages/safejs/src/interp/globals/collections-iteration-validation.test.ts docs/plans/safejs-fix-coll-001-test-types.md
git diff --check
```

| Gate                                            | Actual result                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Isolated dependency installation                | Exit 0, lifecycle scripts disabled; no borrowed node_modules or dist                                      |
| SafeJS/dependency build                         | Exit 0; 22/22 tasks successful, zero cached                                                               |
| Exact supplemental strict compile before repair | Exit 1; **3 TS2345 diagnostics**                                                                          |
| Same supplemental strict compile after repair   | Exit 0; **0 diagnostics**, same twelve roots                                                              |
| Actual-main strict test-inclusive compile       | Exit 0; 10 present historical test roots, no overlay, **0 diagnostics**                                   |
| COLL runtime suites                             | **112 validator + 24 author = 136 passed**                                                                |
| COLL plus adjacent runtime command              | Exit 0; **693 passed in eight files**, zero failed/skipped, 3.58 seconds                                  |
| Configured SafeJS source types                  | Exit 0, no diagnostics                                                                                    |
| Initial configured root types                   | Exit 2; 177 diagnostics from unbuilt local package declarations and consequent inference errors, retained |
| Local root dependency builds                    | Exit 0; 53/53 tasks successful, zero cached; workflow package declaration-only build also passes          |
| Same configured root types after local builds   | Exit 0, no diagnostics; no source/config workaround                                                       |
| Scoped ESLint and test formatting               | Exit 0                                                                                                    |
| Tracked diff hygiene                            | Exit 0                                                                                                    |

The eight runtime files contain 112, 24, 11, 477, 28, 31, 8, and 2 tests respectively. These counts include the COLL suites, not an additional separate 693 tests beyond them. No full-repository, security/adversarial, original-audit, network/FS/process/LLM guest, or new matrix run is performed. The existing snapshot integration fixture uses its existing in-memory setup. This typing-only test repair has no CLI visual impact; screenshots are not applicable.

### Root declaration build commands

The first configured root typecheck was retried unchanged after building the missing local packages. No global or another clone's artifacts were used. Full stdout/stderr and exact argv are retained in `root-dependency-builds.json`.

```sh
env -u TERM ./node_modules/.bin/turbo run build --filter=@poe-code/acp-telemetry --filter=agent-code-review --filter=@poe-code/agent-eval --filter=@poe-code/agent-gaslight --filter=@poe-code/agent-harness --filter=@poe-code/agent-trace-viewer --filter=@poe-code/braintrust --filter=@poe-code/experiment-loop --filter=@poe-code/maestro --filter=@poe-code/maestro-tui --filter=@poe-code/markdown-reader --filter=@poe-code/memory --filter=@poe-code/pipeline --filter=@poe-code/plan-browser --filter=@poe-code/poe-agent --filter=poe-oauth --filter=@poe-code/process-launcher --filter=@poe-code/ralph --filter=@poe-code/superintendent --filter=toolcraft --filter=@poe-code/workspace-resolver --filter=@poe-code/worktree --output-logs=errors-only
env -u TERM ./node_modules/.bin/tsc -p packages/github-workflows/tsconfig.json --emitDeclarationOnly
env -u TERM npm run lint:types
```

## Frozen author handoff

Status: **AWAITING_INDEPENDENT_VALIDATION**. The repair's author checks pass; this is not independent validation or publication approval.

Exactly two publishable paths are frozen under `out/safejs-remediation/coll-001-test-types/candidate/files/`, retaining repository-relative paths:

1. `packages/safejs/src/interp/globals/collections-iteration-validation.test.ts`
2. `docs/plans/safejs-fix-coll-001-test-types.md`

The candidate manifest records base HEAD, exact current/base preimage bytes and SHA-256, captured byte lengths/SHA-256, the test-only diff, and evidence hashes. The original test preimage is retained under `candidate/preimages/current-main/`; the plan is explicitly absent at base. Captures/preimages/manifest are made read-only after byte verification. Independent validation must use the frozen repair and verify preimages rather than assuming later shared state matches.

The independent validator must repeat the three-to-zero typing proof, verify all assertions/oracles/control coverage remain unchanged, rerun the 136 COLL tests and relevant adjacent/configured type gates, and inspect the two-path diff. If the integration base differs, reconcile preimages and record new integrated hashes. No commits, pushes, releases, feature branches, production edits, or writes to other clones are performed by this author.
