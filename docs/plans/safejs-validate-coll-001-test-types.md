# COLL-001 fixture typing: independent validation

## Scope and isolation

Independent delegated validator, not author Galileo. Date: August 29, 2026.
Workspace `/Users/kjopek/Workspace/poe-code-safejs-collection-test-types`, frozen
base `4358488f9478bcb3c5a89af4fcd61c3cdfcf037f`. Applicable instructions are the
workspace-parent and clone-root `AGENTS.md`; no deeper SafeJS/docs instructions.

Author handoff `out/safejs-remediation/coll-001-test-types/handoff.json` identifies
immutable candidate manifest SHA-256
`1017fd3755dbeef609739c6cd131763a035f8f586a7134b1a47ad89698139ace`.
The only code diff is five fixture-line substitutions in
`packages/safejs/src/interp/globals/collections-iteration-validation.test.ts`.
No production/test edits by this validator, new test fixtures, new branches,
commits, pushes, other-clone writes, original audit reads, or security work.
No original exclusions bootstrap is necessary because no original audit metadata
or payload is accessed. No full-suite or publication approval is claimed.

## Independent procedure

1. Verify author manifest, both current/captured files, and test preimage hashes.
2. Independently parse baseline/candidate TypeScript and compare assertions,
   string/template contents, native oracles, all statements outside the helper,
   and emitted JavaScript. Reject suppression/cast/skip or expectation weakening.
3. Run the exact author compiler argv/stdin on both versions. A compiler-only
   preload serves the existing COLL fixture's Git preimage in memory for RED;
   candidate runs use its real current bytes. No working test is replaced.
4. Retain the author's exact two hash-verified absent OBJ test roots in memory
   for the historical twelve-root check; do not silently drop them. Also check
   the ten actually present roots without any overlays.
5. Run existing 136 COLL tests and needed adjacent suites, configured types,
   scoped ESLint, formatting and diff checks. No new matrix or original replay.
6. Freeze exactly the repaired test, author plan and this independent plan, with
   current-base preimage and immutable manifest, only if scoped checks pass.

## Runtime equivalence boundary

`Promise<void>` becomes `Promise<undefined>` and the native resolver accepts an
explicit undefined value. Only three emitted call arguments change: two
`Promise.resolve(undefined)` calls and `release(undefined)`. The original calls
already resolve with undefined. Verify the complete emitted JavaScript matches
after removing exactly these three explicit arguments; do not claim raw emitted
JavaScript is byte-identical. Assertions, native expectations, guest source and
control coverage must remain byte-identical.

## Results

**Scoped-ready.** All checks below were independently executed in the assigned
clone. Evidence is under ignored
`out/safejs-remediation/coll-001-test-types-validation/`.

| Check                                            | Independent result                             | Evidence                       |
| ------------------------------------------------ | ---------------------------------------------- | ------------------------------ |
| Exact twelve-root compiler command, Git preimage | Exit 1; **3 TS2345**, at lines 92, 95, 120     | `compile-red.json`             |
| Identical compiler argv/stdin, candidate         | Exit 0; **0 diagnostics**                      | `compile-green.json`           |
| Actual-main strict source/test compile           | **10 real roots, 0 diagnostics**, no overlays  | `actual-main-types.json`       |
| COLL suites and adjacent runtime                 | **693 passed**, 8 files, no failures/skips     | `runtime.json`, `runtime.log`  |
| COLL subset within that run                      | **112 validator + 24 author = 136 passed**     | `runtime.json`                 |
| Configured SafeJS package types                  | Exit 0                                         | `package-types.log`            |
| Configured root types                            | Exit 0, using already-built local declarations | `root-types.log`               |
| Scoped ESLint                                    | Exit 0                                         | `eslint.log`                   |
| Three publishable paths, Prettier; diff check    | Exit 0                                         | `format.log`, `diff-check.log` |

The exact compiler argv/stdin is retained in both independent records. Both
runs use the same compiler-only preload; `COLL001_BASELINE=1` enables a single
read-only Git-preimage substitution for RED, while `COLL001_BASELINE=0` leaves
the candidate read untouched. The authoritative command's twelve-root body and
two hash-verified absent OBJ fixtures are unchanged. RED confirms the base file
was read once. No production file or working test is replaced, and no diagnostics
are filtered. The separate ten-root check uses the actual filesystem with no
preload or virtual roots.

Independent TypeScript parsing verifies exactly:

- **28 assertion call nodes** unchanged.
- **145 string/template nodes**, including guest sources and expected literals,
  unchanged.
- **Four native `new Function` oracle constructions** unchanged.
- **17 top-level statements outside `verifyCheckpoint`** unchanged.
- No `any` types added; all four existing cast nodes unchanged. No suppression,
  skip, todo, assertion, expected-value, or control-coverage weakening.
- Complete emitted JavaScript equal after removing exactly three explicit
  undefined arguments. Raw emitted JavaScript differs, as expected; the source
  diff remains exactly five added/five removed fixture lines.

Full inventories and before/after/emitted hashes are in
`semantic-preservation.json`; independently calculated hashes also match the
author's preservation evidence. Every author evidence file was hash-verified
and left unchanged, including the initial driver syntax failure, the corrected
three-diagnostic RED, and the initial missing-declaration root failures.

The runtime command reuses the eight existing suites, with snapshot playback/error
and `TERM` removed. It includes the 136 COLL tests, not 693 additional tests.
It completed in 2.85 seconds; no timeout. No new fixture or test matrix was
created. Existing in-memory snapshot fixtures and mock setup remain unchanged.
The author's completed local declaration builds were reused; no dependency
installation, borrowed artifacts, full build or broad research was needed.

```sh
env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error node_modules/.bin/vitest run packages/safejs/src/interp/globals/collections-iteration-validation.test.ts packages/safejs/src/interp/globals/collections-iteration.test.ts packages/safejs/src/interp/globals/collections.test.ts packages/safejs/src/interp/interpreter.test.ts packages/safejs/src/run.random.test.ts packages/safejs/src/run.snapshot.test.ts packages/safejs/src/run.completed-replay.test.ts packages/safejs/test/integration/snapshot-roundtrip.test.ts --reporter=dot
env -u TERM node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
env -u TERM npm run lint:types
env -u TERM node_modules/.bin/eslint packages/safejs/src/interp/globals/collections-iteration-validation.test.ts out/safejs-remediation/coll-001-test-types-validation/baseline-compiler.mjs
```

## Handoff boundary

Exactly three publishable paths are frozen under
`out/safejs-remediation/coll-001-test-types-validation/candidate/`:

1. `packages/safejs/src/interp/globals/collections-iteration-validation.test.ts`
2. `docs/plans/safejs-fix-coll-001-test-types.md`
3. `docs/plans/safejs-validate-coll-001-test-types.md`

The exact current-base test preimage is captured under `preimages/`; both plans
are explicitly absent at base. Candidate files, preimage and manifest use
read-only permissions and macOS user-immutable flags. The manifest records exact
bytes/hashes, compiler command equality, scoped outcomes and retained failures.
Compiler instrumentation and evidence are not publishable code or new fixtures.

No production or test edits were made by the validator. No original audit or
security payloads were read. No commits, pushes, branches, or other-clone writes.
The publisher must reconcile current preimages and run fresh full integration
gates. If the two historical OBJ roots are now present, compile the actual files
without the absent-root overlay. This validation does not change any prior
functional issue's readiness or claim a full-repository pass. No CLI visual
changes; screenshots are not applicable.
