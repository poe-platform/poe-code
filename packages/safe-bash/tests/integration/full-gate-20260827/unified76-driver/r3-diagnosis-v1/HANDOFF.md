# R3 diagnosis — source and preserved data only

2026-08-28. **No new execution authorization is consumed or requested here.**
R3 remains consumed: **19,425 pass /132 fail /7 skip, six of fourteen phases**,
aggregate binding/integrity/cleanup false. This classification subtracts nothing.
The original `c23a8de8` captures, `55d9bb1a` ledger and every failed root remain intact.

## Binding and method

- Product: `f5e9fc49b6abb38e180cc9de16c95fced102ff75`; driver:
  `aca88337d644351888659e4364f0610da0219eb3697de45fa808b509bfbc3424`.
- Expected, **not newly packed**, product tarball:
  `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
- `collect.mjs` imports Node data/filesystem/hash/compression modules only. It
  reads captured JSON/TAP and selected frozen source as bytes; it does not import
  product, fixtures, launchers, private engine, or spawn children.
- All **928** captured files (114,734,734 raw bytes) matched the original
  encoded/compressed/raw hashes and retained files. Original retained raw files
  and the original result-seal inputs were checked again after collection.
- **57** inspected candidate files matched archive SHA-256, Git blob identity,
  the selected profile's blob records, and mode. No source-copy fallback or
  instruction-file materialization. See `OBSERVATIONS.json` and `BINDINGS.json`.
- `FAILURES.json` gives all **132 unique TAP IDs**, exact names, phase, original
  location, stack paths, detail digest, cause group and proposed owner. It links
  back to the unchanged complete details in `../released-run-v3-qualified-h11/TAP-NONPASSING.json`.
  `SKIPS.json` gives all seven names/IDs and source predicates.
- No test, product, native oracle, private-engine, build, setup or gate execution
  occurred. Data assertions are diagnosis integrity checks, not product passes.

## Exhaustive failure routing

Every row is in phase `canonical`. `GROUPS.json` contains the exact qualifications.
No ordinary supported-input product defect is conclusively established by this
read-only triage. **That does not clear the product:** G04/G06/G11 remain unresolved
boundaries, and many later product assertions were never reached.

| Group | Failures | Observed cause and routing |
|---|---:|---|
| G01 | 4 | `diff-patch-stress/editflows/oracles.test.ts`: explicit `/usr/bin/git` returns EPERM. Gate routes explicitly reject that selector; native identity/apply operations fail before valid oracle observations. |
| G02 | 68 | GNU patch native work reports `/tmp/pp*` creation denied: auxiliary34, target-followup18+2, path-regressions12, safety2. Native scratch/profile issue; do not call virtual patch wrong from these comparisons. |
| G03 | 5 | `gnu-target/calibration.test.ts`: **Apple alternate**, not GNU product cases. Apple patch `--version` identity probe fails creating `/tmp/patcho*` before the intended reverse-corruption replay. |
| G04 | 6 | `expr/inactive-prefix.test.ts`: synthetic `StructuralSignal` rejected by `AbortSignal.any` in `RegexSession` before the intended checkpoint. Direct-handler signal-contract question; not an established real-Shell cancellation/reason regression. |
| G05 | 2 | `metadata-stress/chmod-controls.test.ts` and `permission-profile/qualification.test.ts`: wrapped inability to establish initial **directory** mode. Underlying errno is not retained in TAP; no file-mode eligibility waiver applies. |
| G06 | 1 | `metadata-stress/native-differential.test.ts`: complete test fails on captured directory setid status/mode mismatches. Native status1 versus virtual0 is real observed divergence; native stderr/cause absent, so product-vs-host responsibility remains open. |
| G07 | 2 | `permission-profile/darwin-profile.test.ts`: immutable **Node22.22.2** characterizations run under Node24.11.1 and reject that prerequisite. Not two new chmod semantic results. |
| G08 | 5 | Search pipelines: native Bash cannot find `cut`, `sort`, `tee`, `xargs`, `cat` on inherited finite PATH. No valid pipeline oracle for these rows. |
| G09 | 2 | Search safety/streaming wrappers expect TAP; Node24 children print summary reporter output. Captured children report10/10 and6/6, but the two wrapper failures stay failed. |
| G10 | 1 | Stream-inspection live native array: `tac` reports `/var/tmp/cutmp*` creation denied. Explicit child environment omits TMPDIR. |
| G11 | 1 | RealFS special-node test: `listen EINVAL` on a **110-byte** socket path, before FS assertions. Path length is a suspect, not a proven kernel diagnosis. |
| G12 | 1 | S3 HTTP public-export verifier: resets PATH to Node directory plus `/usr/bin:/bin`; bare Git fails EPERM at `rev-parse`. No package/export/service result in this test. |
| G13 | 1 | Native-data positional npm smoke: bare `npm` ENOENT. Its TAP check is not reached; explicit admitted npm CLI elsewhere is not evidence that a bare alias exists here. |
| G14 | 1 | Script-entrypoint strict-header loop expects126; source now accepts `#!/usr/bin/env -S bash` and returns0. Three preceding forms still fail the source's header grammar. Raw loop does not label the specific header; attribution to the last form is source-derived. |
| G15 | 32 | Two heredoc plus30 inline-input cases: **native** snapshot has extra `sh-thd-*`. `runBash` sets TMPDIR equal to cwd, then snapshots it. The native-first file assertion fails, leaving later virtual assertions unreached. No explanation of Bash's retained temporary-file behavior is proved. |
| Total | **132** | No exclusions, deductions or rescoring. |

G01 and G12 record the attempted selector path and EPERM, **not a syscall trace**
of the denial or a newly discovered vulnerability. Do not retrofit the earlier
consumed attempts' unknown EPERM target with this later evidence.

## Seven skips: availability versus dispatch

| Exact source | Rows | Predicate / limitation |
|---|---:|---|
| `tests/commands/bytes-stress/encoding.test.ts` | 3 | base64/base32 Python and tiny-width xxd: PATH-only access discovery fails. |
| `tests/commands/bytes/checksums/native.test.ts` | 1 | cksum discovery exhausts declared routes; skip says “not installed”, but does not establish machine-wide absence. |
| `tests/commands/bytes/encoding/oracle.test.ts` | 1 | bare `xxd -v` returns an error; fixture skips on **any** error, not specifically ENOENT. |
| `tests/commands/grep-aliases/native.test.ts` | 2 | GNU/BSD replay flags are not enabled; GNU also requires an exact capture. No replay or parity credit. |

The51 admitted native assets and18 tool aliases do not contain Python, xxd or
cksum, nor do they make the five search-pipeline tools or bare npm available.
Authenticating an inventory was not proof of full canonical route coverage.
Do not silently add ambient PATH or label these seven rows passed. A successor
zero-skip policy needs explicitly admitted oracles/profile decisions first.

## The286 new entries: actual writers and cleanup contract

The source inventory freezes **after** authorized build/setup. The phase runner
checks it before and after each phase. These paths were absent in that baseline
and appear in the post-canonical comparison, which correctly stops dependent work.
This is not a tracked-files-only guard or a false positive from authorized `dist`.

1. **284 entries /71 native fixture roots.**
   `tests/commands/table-text-stress/corpus.test.ts:27` runs the71-row live GNU
   corpus. `support.ts:52` creates `.native-*` **inside the source test directory**,
   writes `left`, `right`, `sentinel`, validates them, and returns **without removing
   anything**. All71 observed roots contain exactly those three files, the exact
   ownership sentinel, and input bytes compatible with the frozen corpus. The
   existing snapshot/manual-review cleanup utilities are not canonical cleanup.
   Matching inputs do not establish a unique row/PID for duplicates; no write
   syscall trace was captured. This is a fixture scratch-lifetime defect.
2. **One empty `.runtime` parent.**
   `tests/commands/table-text-stress/shared-stdin-fix/support.ts:49` creates it in
   `verifyOracle`. Its `native()` removes child directories in `finally`, **not
   this parent**. The observed parent is empty. This is a distinct fixture root
   cleanup/placement issue, not proof of leaked child processes.
3. **One empty `.runs` parent.**
   `tests/fs/mount/identity-authority-review/implementation/public-comparison.test.ts:37`
   creates it. `context.after` removes the `mkdtemp` child, **not the parent**.
   Again empty, source-local, and outside the frozen baseline.

`OBSERVATIONS.json` records each of286 paths, current type/mode/file hash,
directory children, and matching input candidates. **None was removed or changed.**
Six phase receipts record clean/closed processes with no reported survivors;
that does not turn final aggregate cleanup/integrity true. There was no final sweep.

## Benchmark compiler route: verified infrastructure error

`launcher-v3/execute.mjs:112` requests
`source/benchmarks/node_modules/typescript/bin/tsc`.
The admitted benchmark lock/manifest contains only the comparator dependency,
not TypeScript; the authenticated external benchmark inventory has **zero**
`typescript/` entries. Projection correctly staged that inventory. The missing
path is therefore **not an unexplained lost dependency or failed projection**.

The already admitted root dependency tree **does** contain
`source/node_modules/typescript/bin/tsc`, and it produced the sole driver build.
The benchmark's own script is `tsc --noEmit -p tsconfig.json`; a root compiler
route can be made explicit without new dependencies or ambient fallback.

The audit preload calls `realpathSync(process.argv[1])` at `build-audit.mjs:8`
and fails before the nonexistent entrypoint executes. This does **not** mean
the build-audit guard should be disabled or ENOENT swallowed. Benchmark typing
never ran; its phase status1 is separate from the successful root typecheck.
The driver treated this clean process failure as collectable, then reached
canonical. A future entrypoint-admission check should distinguish a missing
required compiler from a genuine compiler diagnostic exit.

## Minimal prospective repair packets — proposals, not authorization

All old632 bodies/results remain historical. Any helper/fixture correction needs
a separately bound successor recipe/candidate and independent review; no edits,
silent overlays, old-root cleanup, or permission changes were made here.

1. **Driver compiler route** — `launcher-v3/execute.mjs` benchmark phase only,
   plus finite existing-dependency/entrypoint admission checks and driver reseal.
   Use authenticated root `typescript/bin/tsc`, unchanged benchmark cwd/config,
   retained preload and one-production-build audit. Reviewer: Dirac. Proposed
   controls: missing/tampered compiler rejects before launch; benchmark type-error
   remains nonzero; successful noEmit reuses exactly one build; duplicate build
   still rejected; no benchmark-local or source/ambient fallback.
2. **Three scratch helpers** — table-text `support.ts`,
   `shared-stdin-fix/support.ts`, mount `implementation/public-comparison.test.ts`.
   Allocate fresh unique scratch under an explicitly owned temp root outside
   protected source; register cleanup immediately and use finally on all exits.
   Do not solve this by sweeping `.native-*` globally or ignoring new entries.
   Preserve all corpus/native bytes and side-effect assertions. Proposed review:
   two concurrent executions, normal/error/abort paths, sentinel protection,
   exact-created-root cleanup and full source before/after inventory.
3. **Explicit native tool routes** — diff editflow helper and S3 HTTP verifier
   must use an authenticated declared Git path, not `/usr/bin/git` selector;
   native-data helper must route the already admitted npm CLI via pinned Node.
   Keep original Git argv and source-denial tests. Search pipeline PATH needs a
   **finite newly reviewed identity/closure proposal** for cut/sort/tee/xargs/cat
   before any use. No blanket `/usr/bin:/bin` fallback or permissions widening.
   Review read/apply argv, unrelated selector/route refusal and empty-env children.
4. **Native scratch environment** — versioned diff-patch
   `gnu-auxiliary/helpers.ts`, `gnu-target-followup/helpers.ts`,
   `gnu-target/oracle.ts`, and stream-inspection `oracle.ts` should explicitly
   bind TMPDIR to owned scratch **outside the snapshotted fixture effect tree**.
   Also separate native shell scratch from cwd in `tests/shell-stress/helpers.ts`.
   Preserve HOME/locale/argv and exact command-effect comparisons, including
   explicit no-op controls; do not merely filter out `sh-thd-*` or relax expected
   filenames. First bounded reference-only validation needs new authorization;
   retained files do not prove how Bash unlink or native temp selection behaves.
5. **Two nested reporters / one supported header** — add explicit TAP before
   positional paths in search `safety.test.ts` and `streaming.test.ts`, retaining
   exact counts and strict exits. Independent Node22/24 protocol checks should
   kill wrong/missing/zero reports. Separately propose the exact env-S rejection
   assertion migration in `script-entrypoint/cases.ts`, preserving all invalid
   UTF8/header tests and adding accepted-env-S output/effect checks. No blanket
   stale-expectation rewrite.
6. **Unresolved boundaries, not immediate fixes** — expr/regex owners review
   the six StructuralSignal cases against `CommandContext.signal: AbortSignal`.
   If structural signal support is required, repair composition generically with
   exact reason/cleanup controls; if native branded signals are the supported
   input, a separately justified fixture needs real AbortController semantics
   (including undefined's default-reason distinction). Do not swallow TypeError,
   forge reason identity, or silently drop six cases. Metadata owners retain exact
   directory mode/Node22 predicates and request an evidence-bound Node24/control
   profile, **not** repeat denied setid operations now. RealFS owner can propose
   a short owned socket path and cleanup-before-listen validation; EINVAL alone
   is insufficient to change filesystem behavior or widen socket permission.
7. **Seven oracle obligations** — inventory exact supported routes and profile
   artifacts before enabling anything. Native Python/xxd/cksum identities need
   explicit admission if selected; grep flags alone are not GNU capture proof.
   Missing/error probes must not silently masquerade as absence or become passes.

Suggested independent sequence: Dirac audits this132+7 mapping and source/hash
bindings first; root then delegates narrowly separate driver, fixture, signal-
contract and host-profile work. Genuine product corrections, if established,
require their own author/different-verifier loop. Only root can select/release a
new full gate. **No retry or new GO is implied by this handoff.**
