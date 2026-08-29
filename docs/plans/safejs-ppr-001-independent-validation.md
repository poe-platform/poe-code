# PPR-001 independent validation

Date: August 29, 2026. Delegated validator, not author. No publication authority.

## Intake and isolation

- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-promise-aliases`.
- Base: `4358488f9478bcb3c5a89af4fcd61c3cdfcf037f`.
- Author manifest: `out/safejs-remediation/ppr-001/candidate/manifest.json`.
- SHA-256: `5a3bd5cd89b4faa27315d436ed02ccc9da1b78ba8836a31c3d14ecb15d7dafa8`.
- Approved PPR-002 independent prerequisite manifest SHA-256:
  `64b0d70928472558f48bfedeae6699cabd3107c44ef682c2a7a66b01da56cb32`.
- Read applicable AGENTS. Work only in this clone; old PPR-002 clone and evidence
  are read-only. No production edits, Git mutations, other-clone writes, or release.
- All eleven prerequisite files match the prior independently frozen postimages.
  All six existing approved/current base preimages match exactly; the five additions
  are absent at current base. No three-way conflicts or unrelated published fixes
  are replaced. All six PPR-001 delta files match their frozen postimages; the two
  converter preimages match current git base and post-prerequisite images.
- The prerequisite and PPR-001 publication path sets are disjoint. PPR-001 adds
  six memoization lines in two converters, not a PPR-002 replay fix.

## Original archive policy

Before any original payload read, bootstrap `archiveReadPolicy.excludedPaths`
from `/Users/kjopek/Workspace/poe-code/out/safejs-audit-2026-08-27/inventory-verification.json`.
Deny all 38 excluded paths and every `security/` subtree. No recursive archive
scan, excluded read/hash/execution, security research, or original modification.

The complete original-payload allowlist is exactly these two functional sources:

- `public-promise-recovery/01-public-input-scan.ajs`, SHA-256
  `94f71537e4d19ff33a45cb950607c4e1eec1922276f15825166e4658cc64e9ff`.
- `public-promise-recovery/02-public-promise-alias-control.ajs`, SHA-256
  `784f6eb021150c6c0d83365061cea4db1cc53d2504e643900aff633d178347be`.

Both paths are relative to the original audit directory. No reports or additional
original payloads are needed for this independent procedure.

## Agent-executed procedure

1. Independently compare native, PPR-002-only, and candidate executions of unchanged
   original raw-Promise workflows. Preserve complete values, journals, and snapshots.
2. Add actual package tests before execution, using pure bounded host mocks and
   in-memory backends. Cover input-graph aliases, fulfilled/rejected object identity,
   all four input placements, arrays/maps/sets/cycles, and distinct Promises.
3. Compile public-index runtimes in memory: exact current-base v6, current base plus
   approved PPR-002 (pre-memoization v7), and frozen candidate. No file replacement,
   private Promise adaptation, snapshot marker changes, or Git mutations.
4. Capture genuine alias-sensitive old histories with branch-dependent multiple
   Promise registrations. Prove each works in its original runtime before requiring
   candidate replay of unchanged bytes, exact values, and serialized metadata.
5. Restore original workflows and checkpoints in fresh processes without input
   Promises or provider requests. Retain old split-alias outputs on old v7 replay;
   do not silently relabel old history as newly corrected output.
6. Run focused, broad functional, configured type/lint, new-test types, formatting,
   and whitespace checks using `env -u TERM`. Record all failures and limits.
7. Report a root repair request if any regression occurs; never weaken assertions.
   Only if genuinely ready, freeze exact PPR-001 delta and preimages separately from
   prerequisite provenance. No commits, pushes, or publication approval.

Historically broken raw-v6 restoration and historical pending-proof stalls remain
separate. V6 guest-Promise/data-alias compatibility is not a claim that previously
broken raw native input snapshots are retroactively recoverable. Cross-input-root
identity is outside this graph-local repair. Any metadata-container prototype
differences must be qualified separately from serialized replay equality.

## Results

**Disposition: HOLD / not independently ready for a publication freeze.** The
original PPR-001 functional correction and exercised historical compatibility
pass. This is not a finding of a new PPR-001 regression: fourteen retained,
expanded validator assertions remain red, with baseline attribution below, and
the configured repository-wide formatting gate fails. Neither failure set is
waived. No new ready-candidate manifest, production edit, commit, push, or
publication approval is produced.

### Exact intake after execution

Rechecked the author manifest hash, all 60 explicitly listed frozen artifacts,
all 17 working/frozen publication postimages, the current base, and every
applicable base/preimage. All match. The eleven prerequisite paths and six
PPR-001 paths remain disjoint. The six PPR-001 memoization lines are the only
PPR-001 production delta: three in each converter. Exact intake results are in
`out/safejs-remediation/ppr-001-independent/intake-recheck.json`.

The approved PPR-002 manifest and its old clone were only read. No old candidate,
capture, or prior report was rewritten, including the earlier PPR-002 25-pass /
6-fail report. The PPR-001 failures below are a different validation history.

### Original workflows and new identities

- Both hash-locked original sources execute unchanged, using raw native Promise
  fixtures and only the public runtime API. The full source uses arguments; the
  tiny source exercises arguments and the original `incoming` binding fallback.
- Full returned values match native execution after the existing sandbox-object
  prototype distinction is accounted for. The complete full-workflow balance,
  trace, closures, emissions, and alias flags are compared, not just a reduced
  `{ value: 7 }` projection. Tiny results are exactly
  `{ promiseAlias: true, value: 7, sameHandle: true, sameAlias: true, markerVisible: true }`.
- Input journal rows decrease from five to two for the full source and from two
  to one for each tiny placement. PPR-002-only execution still has split aliases;
  the prerequisite alone does not repair PPR-001.
- Eight independent fresh-process restores pass: two each of the full checkpoint,
  full completion, tiny argument completion, and tiny binding completion. Every
  returned field, serialized initial input, host journal, and Promise trace matches.
- The expanded graph covers objects, arrays, Map, Set, a cycle, a distinct Promise,
  and fulfilled-value aliases. Repeated rejection handlers share the same reason
  and observe the same mutation. Baseline rejection representation limitations
  remain explicit below; arbitrary native rejection-payload parity is not claimed.

`nativeExact` compares `structuredClone(returnValue)` to the complete native
value using Node deep strict equality. It is not an input adapter and preserves
values, types, aliases, and cycles. `rawNativeExact` is recorded separately.
Sandbox object literals use a null prototype (`interp/interpreter.ts:554`), so
unqualified raw native-prototype equality is false even without this patch.
Likewise, raw snapshot metadata-container equality is recorded separately from
serialized equality; null-prototype property tables are not JSON object
prototypes. No claim of raw metadata-container prototype identity is made.

### Historical compatibility and version decision

The baseline engines are compiled in memory from the public index. The v6 engine
uses the exact current-base preimages for the four PPR-002 production paths and
the two PPR-001 converters. The previous-v7 engine uses the approved PPR-002
runtime with only the two converter preimages overlaid. Newer published fixes in
other files are retained. No source file or snapshot marker is rewritten.

1. The retained six genuine working v6 snapshots pass their existing compatibility
   tests, including three replay generations each: eighteen successful generations.
   Failure checkpoints, source mismatch, migration, and unsupported-version
   pre-input-read checks also pass in the focused suite.
2. Independent v6 captures add shared-data, distinct-data, and completed-host-data
   branches with guest Promise aliases and branch-dependent multiple Promise
   registrations. Six saved/completed histories work in their own v6 runtime and
   pass eighteen candidate generations in fresh processes. Every checkpoint stays
   v6; old values, effects, initial inputs, journals, and Promise traces remain exact.
   Together these two cohorts exercise thirty-six successful v6 generations;
   only the second cohort's eighteen are separate child-process generations.
3. Four original raw-input v6 histories are independently recaptured: full saved
   and completed, tiny argument completed, and tiny binding completed. Four more
   raw-input alias-branch histories use two distinct native Promises, each aliased
   twice. All eight fail in their own v6 runtime and in the candidate with the
   same `TypeError: Promise replay references work not created at this position.`
   They are not blanket version refusals and are not retroactively repaired.
4. Eight independent pre-memoization v7 histories cover the originals and two
   alias-sensitive branch workflows. Those branches record four input rows and
   three guest jobs before repair versus two rows and one job in new corrected
   runs. Each old history first works in its original runtime, then retains its
   old split-alias values and exact complete trace through two candidate generations
   (sixteen fresh-process restores). Replaying history does not silently apply the
   newly corrected alias-dependent branch.
5. Eight additional previous-v7 graph histories cover all four input placements,
   saved and completed. Candidate replay matches previous-runtime replay under
   identical continuation timing, including full Promise metadata. Thus sixteen
   independently captured v7 histories pass twenty-four candidate restores.
   The author's three separately captured historical-v7 fixtures also pass the
   independently run focused/broad tests; they are not substituted for these cases.

The mechanism is compatible in these cohorts: `snapshot/replay-inputs.ts:22`
serializes Promise capability identities for new inputs, and its saved-input
path decodes the stored identities rather than collapsing old distinct wrappers.
The per-conversion memo affects new graphs; it does not merge old journal IDs.
PPR-002's `run.ts:194` selects v6 conversion behavior and emits v6 checkpoints
when restoring v6. PPR-001 adds no marker change or blanket refusal.

There is no demonstrated need for an additional PPR-001 version bump, major
release, or migration based on these compatibility probes. The unrelated
jobs-v1 incompatibility does not justify breaking working v6. This is a bounded
compatibility finding, not universal replay certification or a release approval.

### Retained failure history and attribution

All runs and earlier test bytes are retained, without overwriting prior evidence:

| Run                                        | Passed | Failed | Evidence file                 |
| ------------------------------------------ | -----: | -----: | ----------------------------- |
| Initial                                    |     18 |     25 | `independent-initial.log`     |
| Full-value/prototype diagnostic correction |     33 |     14 | `independent-second.log`      |
| Baseline attribution added                 |     45 |     14 | `independent-diagnostics.log` |
| Graph continuation attribution added       |     69 |     14 | `independent-attribution.log` |
| Formatted-source confirmation              |     69 |     14 | `independent-final.log`       |
| Raw-v6 attribution added, final suite      |     77 |     14 | `independent-v6-raw.log`      |

Files in this table are under `out/safejs-remediation/ppr-001-independent/`.
The final suite contains 91 tests. It logs 190 bounded child-process observations:
54 captures and 136 restores, with zero provider requests. All final fourteen
failing assertions remain in the actual package test; they were not skipped,
inverted, or removed to obtain a green verdict. Added attribution probes pass
without changing those assertions.

The initial oracle incorrectly demanded native object prototypes. The original
test bytes and failure log remain; the corrected comparison still checks the
entire returned value and records the raw prototype mismatch. The subsequent
fourteen failures have three specific causes:

- **Four native Error representation assertions:** argument and `import.meta`
  rejected-graph captures return a caught TypeError rather than native Error `7`,
  for both saved/completed cases. A simple two-reference fixture proves that
  previous-v7 and candidate both report
  `Unsupported sandbox value at <root>: Error`; only reason alias identity changes
  from false to true. `interp/values.ts:513` copies settlement data through the
  existing generic converter, unlike the host bridge's Error path. Bindings and
  imports preserve the Error name/message. These are existing representation
  differences, not a demonstrated PPR-001 regression. The strict native-parity
  assertions remain red. An exploratory public AggregateError argument probe also
  could not access `.errors[0]`; it is not claimed as supported or fixed.
- **Six complete-future-trace assertions:** saved graph checkpoints record a
  prefix; the original capture delays the pending boundary until snapshot write,
  while replay re-issues it immediately. Later, previously unrecorded settlements
  consequently have a different order. All four fulfilled cases reproduce this
  in previous-v7 against itself. `CHECKPOINT_REPLAY.md:3` promises replay of the
  recorded history and declares pending re-issue; it does not promise identical
  future scheduling for a different completion latency. The saved prefix is exact,
  and all sixteen graph saved/completed continuations pass additional checks for
  values, input history, host history, recorded-prefix equality, and stable replay
  of their new completed trace. Eight old-v7 graph comparisons also match previous
  and candidate complete metadata under the same continuation latency. The six
  stronger original final-trace assertions nevertheless remain red, not waived.
- **Four previous-run-success assumptions:** the pre-memoization plain-object
  rejection graph fails with `UnhandledRejectionError` because other split input
  wrappers have unhandled rejections. The candidate shares the wrapper and
  completes. Smaller two-reference probes show the same baseline normalization
  of non-Error reasons before/after repair, while reason identity improves.
  `interp/host-bridge.test.ts:630` explicitly checks that non-Error host rejections
  do not retain arbitrary metadata. The candidate does not recover the original
  custom `.value` field, and the four assumption assertions remain red.

These findings do **not** support asking the author to alter six-line memoization
to hide a compatibility regression: none was established. Parent action is
contract/oracle adjudication, not an automatic production repair. If full native
Error or arbitrary rejection-object representation is required as an additional
acceptance criterion, request a separately scoped converter repair with native
parity and old-history tests, then a new frozen candidate. Do not fold that change
silently into PPR-001. Similarly, deterministic continuation independent of
pending-operation latency would require an explicit additional contract, not
rewriting recorded version markers or weakening replay checks.

### Configured and broad checks

All executions use `env -u TERM`:

- Focused original recovery / compatibility / alias suites: **43/43 pass**.
- Explicit functional broad allowlist: **547/547 pass, 21 files**. The list covers
  replay stress, snapshot restore, references, alias tests, completed/failure/public
  replay, migrations, Promise order, host bridge/calls, crash resume, values, dump,
  replay-data, public restore, Promise replay, and replay-inputs. No adversarial or
  security suite is included. `broad-confirmation.log` records the clean exit.
- Configured `lint:types`, `lint:eslint`, and `lint:packages`: **pass**; package lint
  passes all seventeen rules. Package `tsc --noEmit`: **pass**. Explicit NodeNext
  strict types for the new integration test, its config, and author alias test:
  **pass**. `git diff --check`: **pass**.
- Initial targeted formatting flagged only the validator test. It was formatted
  via `apply_patch`, without changing assertions. Final targeted formatting passes
  all six PPR-001 paths and all three validator-owned paths. Configured `npm run format`
  remains **failed: 1,442 files**. None of the six PPR-001 paths is flagged; the
  exact approved PPR-002 Markdown plan is flagged among unrelated repository files.
  Those files are not rewritten, and the global gate is not described as passing.
- Two command wrappers attempted to assign zsh's read-only `status` variable after
  Vitest. The logs remain; broad validation was rerun with a valid variable and
  returned zero. The final independent suite correctly returns one for its fourteen
  assertions. These shell-wrapper errors are not test successes.
- Full repository build and live CLI screenshots were not run: no visual behavior
  changes, package dependency changes, or build diagnosis required them. Public
  runtime compilation for all three engines and configured type checks succeeded.
  No author-only full-build result is claimed as independently executed.

### Reproduction and limits

The actual test is
`packages/safejs/test/integration/promise-alias-independent.test.ts`; its bounded
config is `packages/safejs/test/promise-alias-validation.vitest.config.ts`.
Run from this clone with:

```sh
env -u TERM node_modules/.bin/vitest run --config packages/safejs/test/promise-alias-validation.vitest.config.ts
```

It intentionally still exits nonzero for the retained fourteen assertions.
It requires the explicit two original allowlisted sources, the frozen author
artifact, and the git base; it is local validation evidence, not an automatically
portable publication-test addition. No executable QA script is placed in planning
docs. The test writes no files, uses in-memory snapshots/bundles, and bounds child
work with deadlines. Only pure declared host mocks run. No provider, real LLM,
guest filesystem/network operation, private Promise adapter, caller replacement
Promise on restore, or fabricated reconciliation proof is used.

Cross-root alias identity, arbitrary rejection metadata, historically broken
raw-v6 restoration, pending-proof stalls, and universal asynchronous scheduling
equivalence are not asserted to be fixed. No excluded original path or security
payload was read, hashed, or executed. No recursive original-audit scan occurred.

Evidence checksums, the unchanged intake hashes, and a frozen text copy of the
final test accompany this report in `evidence-manifest.json` under the independent
output directory. That manifest is explicitly **not a ready publication manifest**;
no independent publishable freeze is emitted while these gates remain unresolved.
