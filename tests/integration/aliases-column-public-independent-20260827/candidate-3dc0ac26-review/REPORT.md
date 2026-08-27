# Independent frozen public integration review — August 27, 2026

## Verdict and important artifact distinction

**PASS scoped: the exact authorized package passes the unchanged frozen public
consumer and every proposed control through the separately recorded external
exact-artifact admission/replay harness. No product bug was observed.**

**The unmodified frozen runner's own exact-pack admission is REJECTED.** Its
`git archive` arguments omit `README.md`, producing a 737-file package with SHA-256
`40fe53856586ee115446591c6afb2f0d05c38d3e3302f89f84aa323ba936c8d9`, not the required
artifact. The immutable runner uses tar extraction, not npm installation. Its
reported 56/56 PASS is preserved but is **not** labeled acceptance of the required
tarball. No frozen file, case, expectation, runner, or declaration schema changed.

The independent external harness archives `README.md` from the **same authorized
candidate**, rebuilds with the authenticated compiler, obtains the exact required
tarball, admits it by SHA-256 **before installation or execution**, performs an
actual offline npm install, moves the regular installed consumer directory, and
replays the byte-identical frozen consumer/cases plus all controls. This route is
explicitly separate evidence, not a correction or rescore of the frozen runner.
If an approval requires the *unmodified driver itself* to generate that exact pack,
that narrower requirement remains blocked by the preserved fixture discrepancy.

## Immutable identities and assembly

| Input | Exact identity |
| --- | --- |
| Author source | `cb940da68052a9f1ab7e115279900d277e051fdb` |
| Author evidence | `899b3d7b8a81f094e7a7feae89f307eebade5480` |
| Ledger | `ce2729f55be7e74fd53e73833eed249e4a8f9b1e` |
| Accepted base / candidate's sole parent | `0123c83d3aae72a15621acbb29a165b97b2c6ab6` |
| Exact candidate | `3dc0ac26d681badfd4db6319f2630274095c3100` |
| Candidate tree | `badd2ec61bdbfcbf977f0c682cb5683f2f6dcebe` |
| Frozen fixture, all 11 files | `dbceec2b9890927ea93cee3b416f78908c648cc6` |
| Supplied and independently rebuilt pack SHA-256 | `994dca37308937059b1adacade54f24bd8227589ad65c46c7f4fb661c702c9d5` |

The candidate has **exactly 14** changed paths relative to the accepted base.
Every other baseline path is unchanged, including file modes, blobs, deletions,
and additions. Each candidate binding matches both the recorded manifest blob
and an independently read authoritative source revision. The first four paths
below match `cb940da6`; the remaining ten match the committed final harness/fixture
revision `0bd5c20bd19b3993e2ec9eb48b2a00dcd9ffba44`:

1. `README.md`
2. `package.json`
3. `src/index.ts`
4. `src/plugins/index.ts`
5. `tests/integration/stream-inspection-public-author/consumer.mts`
6. `tests/integration/stream-inspection-public-author/public.test.ts`
7. `tests/plugins/agent-commands.test.ts`
8. `tests/plugins/aliases-column-public-author/FIXTURE_CORRECTION.md`
9. `tests/plugins/aliases-column-public-author/MIGRATION.md`
10. `tests/plugins/aliases-column-public-author/consumer.ts.fixture`
11. `tests/plugins/aliases-column-public-author/negative.ts.fixture`
12. `tests/plugins/aliases-column-public-author/verify.mjs`
13. `tests/plugins/stream-five-fixture-migration/public-options.mts`
14. `tests/plugins/stream-five-fixture-migration/registry.test.ts`

Full base/candidate inventories, candidate/source blob IDs and SHA-256 values are
in `review/authentication.json` inside the capture and the bindings in `SUMMARY.json`.
The alias, column, tree and regex-execution source trees exactly match accepted0123.
The exhaustive path comparison excludes concurrent tree/regex/du deltas; mutable
HEAD was never the candidate input. No branch, worktree or shared index was used
to assemble another candidate.

## Independent execution results

| Check | Observed result |
| --- | --- |
| Frozen syntax checks | 4/4, exit 0 |
| Frozen self-check | PASS; 21 data cases, 73 names, 22 rejected manifest mutations |
| Unmodified frozen candidate runtime | 56/56; wrong-pack admission rejected separately |
| Exact independently rebuilt pack | Matches supplied and required SHA-256 |
| Actual offline npm install | Exit 0; zero runtime dependency additions; regular installed files |
| Exact-pack unchanged frozen consumer | 56/56; no failed runtime rows |
| Frozen positive strict consumer | PASS in both runs, complete resolution traces retained |
| Frozen negative types | 13 exact lines, 4–16, in both runs; 9 TS2322, 2 TS2353, 2 TS2339 |
| Aggregate invalid routes | All four regex/column calls exercised, not baseline-deferred controls |
| Missing root and both explicit subpath exports | 3/3 actual ERR_PACKAGE_PATH_NOT_EXPORTED refusals per run |
| Poisoned source fallback | Rejected in both runs |
| Actual direct repository-source reads | ERR_ACCESS_DENIED in both runs |
| Removed actual worker entry | WORKER_ERROR refusal; worker exits without ready, both runs |
| Corrupted expected output | Exactly 55 pass / 1 intentional failure in each run |
| Supplemental grep | 4/4: plugin and definition routes, 37ms limit and matching success controls |
| Supplemental named option types | Strict positive root and both explicit subpaths PASS |
| Supplemental nested column.replace | Exactly two TS2353 diagnostics through both aggregate factories |
| Source, installed package, fixture inventories | Unchanged through execution, including new-entry detection |
| Compiler prerequisites and Node executable | Before/after identities unchanged |

All expected nonzero process exits, full diagnostics and the exact failing
`public-default:extended-alternation` sensitivity row are retained, not counted
as product failures. The worker-layout control deliberately has no ready event.
These independent totals are not the author's 63 canonical or 17 packed cases.

The full manifest declares both **explicit** `./commands/grep-aliases` and
`./commands/column` entries, the complete candidate exports object and required
root functions. Root/subpath functions have identical runtime identities. No
general commands wildcard was introduced or assumed. Aggregate routes are exactly
`regex` and `column`; column options retain `limits` and omit nested `replace`.
The frozen cases exercise both untyped nested-replacement directions, requiring
top-level `replace` to remain authoritative, plus alias propagation and column
limits on plugin and definition routes. Supplemental grep runs fill the frozen
alias-only propagation gap without changing its denominator. Named-type imports
and the omitted nested replacement type were also supplemental, not frozen cases.

## Actual loads, workers and isolation

Each main frozen consumer observed **181 actual main-thread load-source hashes**
and **33 real workers, all ready and exited**. The exact-pack supplemental grep
consumer observed another 181 loads and four ready/exited workers. Every actual
main-thread product load and selected worker entry hash matches the admitted
installed package. Strict compiler traces resolve root and both subpaths to that
relocated package's declarations, not repository source or live dist.

Across the two main runs, their two corrupted-output runs, two removed-layout
controls and supplemental grep, **138/138 observed workers exited**: 136 had a
ready handshake; two intentionally removed-entry workers did not. All recorded
worker exit codes are 1, consistent with the existing retirement behavior and
the intentional missing-entry controls; this is not a claim of exit-code-0
workers. Public exec/dispose cleanup assertions pass, including the frozen
abort, VFS iterator-return and late-rejection boundaries. No verifier termination
or weakened worker policy is introduced. Worker hashes are **selected-entry
evidence**, not a complete in-worker module-load trace.

The original runner relocated its tar-extracted installation and retired source.
The separate exact run performed offline npm install with scripts disabled,
then moved the directory and retired its source build. Product loads use only
public bare specifiers and real installed dist. Read-only development compiler
tooling is authenticated separately; Node type declarations are copied. The only
installed payload difference between the original and exact packages is the
candidate README; all other 737 installed files are byte-identical. No source or
dist fallback into the live repository was used.

Node22.22.2, npm10.9.7, TypeScript5.9.3 on Darwin arm64 are the measured profile.
The exact-artifact replay ran 17:36:21.816–17:36:43.135 UTC on August 27, 2026.
Full timestamps and commands for every frozen/external step are captured.
The runner uses Node's default temporary directory under `/private/var/folders`;
the external review uses regular files under `/tmp` (real path `/private/tmp`).
No frozen-directory reconstruction was needed: all 11 local files matched the
freeze before all executions. New report files were added **only after all frozen
and external executions finished**. Original historical JSON and freeze files
remain unchanged. Future runs must use an appropriately isolated pristine frozen
fixture tree, not delete these appended records to satisfy the tree check.

## Author history: authenticated, not independently rescored

The immutable author capture verifier passes over **58 raw files**, including all
four attempts and the actual supplied tarball. The capture bytes, manifest,
reports and correction diffs are retained. Its successful final author results
are build/types, 63/63 canonical tests, 17/17 packed tests twice, six type negatives,
two maintained consumers and six fallback controls. These were inspected and
authenticated, **not rerun as independent module audits**.

- Attempt01 `488ef9e320d8c5f8152794cfc05cdac7ab16a852`: 12/16 packed tests;
  four assertions incorrectly expected synchronous Shell.use exceptions. The
  accepted source queues plugin setup; the corrected fixture uses setup for
  synchronous preflight and adds a separate deferred Shell rejection case.
- Attempt02 `e19bddde0c24f7ef0e1ba1292c7dbb20b2592116`: 61/63 expanded canonical
  tests; two incomplete stream-registry migrations. Package phase not reached.
- Attempt03 `a2a8f87fd9656948de2eabe9d36388497186653e`: 14/17 packed tests;
  three assertions compared stored entries to caller input objects. The accepted
  CommandRegistry stores a frozen copy. Corrections compare the actual stored
  before/after entries, preserving the intended unrelated-entry assertion.
- Attempt04 is the exact candidate here. Product root wiring/package blobs match
  across all four attempts. Fixture correction and count migration commits touch
  only tests. The 16-to-17 case expansion is disclosed, not an unchanged-cohort or
  first-pass claim. Original failures, unreached phases and cleanup observations
  remain in the immutable archive.

This review also preserved two preliminary authentication-helper path errors
(`src/commands/regex` and `src/regex` do not exist). After inspecting the actual
Git path, the helper used `src/commands/regex-execution`. No product execution had
started at either error. The second raw stderr is captured; the first appeared
in the terminal transcript only. These were reviewer tooling errors, not frozen
fixture or candidate test failures.

## Raw evidence and remaining limits

`raw-results.tar.gz.b64` reversibly preserves **122 files**, including full frozen
and external stdout/stderr records, reports, npm metadata/installed lock, TS traces,
all diagnostic attribution, source archives, both tarball identities, consumer
inputs, actual load/worker observations, before/after inventories, executed
external scripts, author raw capture and immutable correction evidence.
`RAW-MANIFEST.json` authenticates every decoded file plus the compressed archive.

Run `node tests/integration/aliases-column-public-independent-20260827/candidate-3dc0ac26-review/verify-evidence.mjs`
to authenticate this capture without executing product code or changing the
frozen fixture. The verifier uses a new temporary extraction directory and removes
only that directory. Recorded external drivers contain the actual execution paths;
their captured inputs and commands, not mutable HEAD, define this review.
`VALIDATION.json` records the successful capture-verifier stdout/stderr and the
removal of only this review's two unique scratch directories after authentication.

No product edits, source bug, broad gate rerun, private engine access, dependency
addition, deployed-provider acceptance, universal parity, superiority or 72-hour
completion claim is made. Inventory equality detects added entries at the recorded
boundaries, not identical-byte write attempts or arbitrary malicious host activity.
The exact-artifact external PASS does not make the original runner's mismatching
pack accepted; that fixture packaging limitation remains explicitly open.
