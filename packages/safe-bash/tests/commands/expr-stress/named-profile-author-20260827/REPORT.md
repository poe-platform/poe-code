# Qualified named scalar encoding — author candidate

## Identity and boundary

- Product/new-test commit: `246aa440c988d6c09464480956c4eff69009f7e4`.
- Independent frozen design: `47309c0be322f685431e2b6579edd86d56b79fdd`,
  `../named-profile-design-20260827/`. Its receipt was read, the complete directory
  compared to that commit, and sealed `verify.mjs` passed **before product edits**.
  Its 14 selector and 517 admission-model checks were design evidence, not then
  product acceptance. Each capture authenticates the design again.
- Final author capture: `candidate-03/`. Its timed build/check/runtime commands
  ran August 27, 2026, 19:32:07–19:32:26 UTC. This records actual command time,
  not 72 hours of work. The source commit was made at 19:27:13 UTC.
- Implemented by the delegated leaf without redelegation. Only `internal.ts`,
  the matcher-admission import/call in `index.ts`, the new named-profile test,
  this new evidence directory and narrow README locale text are owned edits.
  No `evaluate.ts`, syntax, BRE worker, shared protocol/client/worker, root export,
  package, default registration or other worker's source was changed by this leaf.

Only exact `en_US.UTF-8` is newly accepted for qualified scalar CHARACTER
encoding. `length`, `substr`, `index`, plain matching, dot and captures reuse
existing scalar machinery. Each category independently resolves the first
nonempty LC_ALL, its category, LANG, then virtual C. Whitespace is nonempty.
There is no ambient locale, suffix alias, Intl, main-thread regex, dependency or
new descriptor/protocol. Numeric comparisons, arithmetic and literal values do
not globally reject irrelevant locales. Named nonnumeric collation retains the
exact old refusal, including ASCII equality.

If either effective CTYPE or COLLATE is outside C/POSIX/C.UTF-8/C.utf8, a
bounded escape-aware scan refuses every unescaped bracket opener. **Literal and
negated lists are also conservatively refused**, including `[a]`, `[é]`, `[^a]`;
these lists are not mislabeled inherently locale-sensitive. Escaped literal
brackets remain admissible. Both byte caps precede the screen; the whole scan
is charged before indexed reads and the existing worker receives remaining work.
Admission does not promise that every BRE is valid or supported.

## Final scoped results

All rows below use only the committed archive; unrelated live edits neither enter
nor veto it. There is no source overlay and no native execution/recapture.

| Check | Actual result |
| --- | --- |
| Source/declaration build, `tsc -p tsconfig.build.json` | exit 0 |
| Scoped expr/source strict types, existing expr tsconfig | exit 0 |
| Three selected shared test consumers, strict NodeNext/ES2023 flags | exit 0 |
| New named-profile tests | 86 tests, 86 pass, 0 fail |
| Existing nonnative expr tests | 308 tests, 307 pass, **1 expected stale failure** |
| Selected shared executor/command/cleanup tests | 85 tests, 85 pass, 0 fail |
| Contracts/limits/lifecycle overlap | 48 tests, 47 pass, **same stale failure**; subset, not additive |

Every executed suite has zero skipped, cancelled and TODO tests. The unchanged
`contracts.test.ts:40` test expects named `length` to fail; its first assertion
now observes status 0 instead of 2. It is preserved as a real failure, not waived,
edited, skipped or counted as a pass. The new tests separately verify the old
named collation refusal that this stale loop no longer reaches. Existing fixed
`[]`/`--` grammar fixtures remain untouched. `native.test.ts` and
`regex-native.test.ts` (four tests) are outside this explicitly nonnative scope;
the old 312-test full expr baseline is not presented as a current candidate run.

The new tests exercise direct commands **and actual Shell registry execution**:
category precedence, empty/whitespace fallthrough, exact-name negative aliases,
literal/negated/range/class/equivalence/collating bracket refusals, escapes with
0–8 preceding backslashes, trailing-escape worker diagnostics, UTF-8 byte caps,
the hard subject cap, precharge-before-read, remaining worker budget, zero
short-circuit/refusal jobs, and false/0/empty-string/null cancellation. Overlapping
registered cleanup and Shell settlement await admitted worker retirement.

Each of two fresh built-runtime processes (harness ambient C and en_US.UTF-8)
records **9 new scalar successes plus 1 continued collation refusal**, directly
and through Shell, with exact status/stdout/stderr bytes against frozen historical
expectations. The original ten mismatch rows remain byte-for-byte separate in
`historical10.json`, including their original inputs, environments, GNU9.7 Darwin
profile, outputs and provenance. No original mismatch is relabeled a pass.

Each runtime process also runs all 517 design admission inputs, now against actual
commands and unchanged workers, plus two empty/default environment controls.
Admitted worker syntax/unsupported results remain visible and **are not matching
successes**. Scalar operation fixtures are explicitly `length é`, `index Aé😀 😀`
and `substr Aé😀 2 1`, with exact byte/scalar output checks. They are supplemental
fixtures, not additional native oracle captures. The two process repetitions are
not 1,034 independent design inputs.

## Preserved failed/intermediate attempts

1. The earlier `/tmp/expr-named-profile-author-20260827-candidate.txt` is preserved
   separately in every capture as `blocked-baseline-receipt.txt`. It remains
   **BLOCKED BASELINE ONLY**, actual 312 expr + 85 shared + 48 overlap passes;
   overlap is not additive. It is not this implementation candidate.
2. Preliminary live new tests passed 86/86 with 74 workers retired. Live scoped
   typechecking encountered concurrent, unowned `src/contracts/output.ts` missing
   `Value` type errors at lines 90 and 99. No shared-source fix was attempted.
3. `candidate-01/commands.json` preserves the first archive attempt: build and expr
   types passed; a newly authored shared-type CLI omitted `--lib ES2023`, bringing
   DOM RequestInit into a Node-only check and rejecting WebDAV's `duplex` field.
   The harness was corrected to match the project lib; product code was not fixed
   or relaxed. This incomplete attempt has no final source-inventory claim.
4. `candidate-02/` preserves the first complete archive run. Review then found
   that its supplemental runtime driver mapped ten named/baseline `index` and
   `substr` model rows to `length`. Its test suites and historical9+1 were not
   affected, but this is **not unchanged all-input operation proof**. Its original
   driver is retained as `runtime.mjs.data`, authenticated against its recorded
   hash. `candidate-03` corrects the mapping and adds exact operation outputs;
   previous observations are not rewritten or silently promoted.

## Separate RED contract

The output-cap/documentation inconsistency sealed at
`0a86a4b43fc9173d0cd6bb49da93bf77f0d4bdd6`,
`../fixture-output-contract-20260827/REPORT.md`, remains **RED and unresolved**.
This assignment does not change output caps, parser diagnostic cap behavior or
the README's output-cap contract wording. The locale-only documentation additions
do not reconcile or waive that separate issue. It is not the one stale canonical
locale assertion and must not be merged into its count.

## Source binding, cleanup and reproduction

Final archive SHA-256:
`f0868c9474f743c80f71f1861a7d816cf19218b38372b9f9ce64ff859c57b930`.
`candidate-03/inputs.json` records every archived source/config/test file hash,
directory inventory, built artifact hash, design inventory and harness hash.
Key source SHA-256 values:

| Path | SHA-256 |
| --- | --- |
| `src/commands/expr/internal.ts` | `07f203d8fc4e991e4d23cab87d67a23911f7960a2ed6d649fd843b0d7060e840` |
| `src/commands/expr/index.ts` | `4fd60b3b2fec4126e42e492922004e90e870a08aa319d2f088c085255355841d` |
| `tests/commands/expr/named-profile.test.ts` | `0ed5438f5713793ee30f462b08685b53cd93c3a65b94009dba62edf7c9e97349` |
| unchanged archived `evaluate.ts` | `80f8b4b7fbcd0552dd91772b941e6654c0b8dd08ce980814b811f08959015d61` |
| unchanged archived `bre-worker.ts` | `f5c67e9c76b584337ae506b59449ecdcd945207b2269fdb4f79c5d1f7e81aff0` |

Complete archive input, dist and design pre/post inventories detect additions,
deletions and changes, not just edits to originally tracked files. Node v22.22.2,
TypeScript 5.9.3 and tsx 4.23.12 ran on Darwin arm64. Installed development tools
are shared from node_modules; versions and committed lockfile are recorded, not
a hermetic dependency-store qualification. No native prerequisite is needed here.

Final cleanup observations: new tests 74 workers, existing abort tests 138,
existing expr lifecycle 20, shared controlled workers 23 and executor workers 17;
all active counts zero before safety cleanup, with zero remaining listeners where
instrumented. Overlap repeats the same 20-worker lifecycle subset. Each built
runtime process reports 130 workers and zero active before safety cleanup; each
individual invocation asserts retirement at settlement. All owned temporary
archive directories are removed in finally. These are owned-process observations,
not claims about other workers' processes.

Read-only frozen verification:

`node tests/commands/expr-stress/named-profile-author-20260827/verify.mjs`

Explicit recapture uses a **new** basename and refuses overwrite:

`node tests/commands/expr-stress/named-profile-author-20260827/capture.mjs new-run-name`

It binds the same immutable source commit, not live product inputs. A new run
inside this sealed directory changes its complete inventory and is not part of
the existing seal. There is no canonical/default evidence writer. Captured `.data`
and JSON are evidence, not canonical TypeScript test inputs.

**Independent final candidate review remains assigned separately.** No public
expr integration, full named locale support, full GNU/POSIX parity, whole gate,
superiority or overall project completion is claimed. Concurrent inactive-prefix,
repeat and other source changes are not certified by this archived candidate.
