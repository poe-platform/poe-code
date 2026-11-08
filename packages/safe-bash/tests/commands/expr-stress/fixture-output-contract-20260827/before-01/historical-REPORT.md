# Sealed candidate execution review

August 27, 2026. A different final execution leaf performed this work directly;
no delegation, source changes, root/export changes, or golden rewrites occurred.
Owned writes are this new subtree and explicitly owned temporary paths. Other
workers' staged changes and temporary artifacts were not cleaned or committed.

**The requested nine C diagnostics close 9/9 in measured execution. This is not
full expr acceptance: ten GNU locale mismatches, five nullable mismatches, one
AST-first precedence counterexample, one frozen cap-profile failure, and two
unchanged legacy grammar assertion failures remain.**

## Identities and isolation

- Candidate source/tests: `21220b465537bf45ffcfb36740956a69f43bf75e`.
- Author evidence: `7fc76f3917a38c0cc39d46c02383c947fa3ac110`.
- Independent input freeze: `d0fb3ef0bc9c3c04cae829a47454c10e565ad971`.
- Prepared harness: `1231700a9f049262235759bbf07f58b939ae646b`.
- Original freeze: `35aa8054ac0ebc1eacefc7cde63e4706f4c72137`.
- Extension/correction freeze: `92fe8a6335366b93cbc9a80d61fede69af711444`.
- Fixed previous review: `50b1e560b11adfcd1d1726896832c3c524e28c4d`.

The historical preparation's candidate-unavailable/zero-acceptance statements
remain unchanged historical records. They do not describe this execution.
`bindings.json` records all 25 copied inputs/helpers, original and new SHA256s,
and literal replacement strings with occurrence counts. Bindings change only
the owned output path, candidate handoff path, and comparator acceptance label.
The corrected Git inventory parser splits at the first metadata tab, preserving
literal tabs in filenames. Its old defective version and failure evidence remain
in the untouched preparation. No frozen expectation was edited.

The exact Git archive was built with authenticated existing development tools,
packed offline without scripts, installed offline without scripts, and physically
moved. Runtime dependencies are empty. Plain Node used the installed physical
`dist/commands/expr/index.js`; strict `skipLibCheck:false` declarations resolved
from that actual installation. The public root imports successfully, but expr is
not exported from it or a public package subpath. There was no source fallback,
main-checkout install, private package integration, or runtime dependency addition.
The older `8f19a9d5bb244ff6c095b7117e6d0738fdf40421` archive was separately built
and installed only for the unchanged supplemental shared-command comparison.

Candidate identity receipts:

| Artifact | SHA256 / identity |
| --- | --- |
| Git source tree | `ae6ea79a296702decfb891aea1cd141b7af17bc5` |
| 237 source files, author's `src/`-prefixed manifest | `d219506fb17ebe1d988b692c9ede0fd6d77c14289ce2fa71acdd530b6b701f55` |
| Same files, staged relative-path manifest | `82481e3b4a44aa72d1f2b314b0d0ab6be41978a70af23928b8f3153613306f03` |
| Complete 28,167 source/test entries | `5c4a65fc6f22f5068223be1bf039040688b395cbf7f1e18a8febda7c343c412b` |
| Git archive | `cf7e22e7604e7ab6e723d1a0739733d4b0cb8a646b0a8207a82649fb9127ab53` |
| Packed package | `990c2ae19c32b15edcc126ed6af3e814ba2d6290fea707fd27acd94163066082` |
| 790 installed files | `cc3d0df2f3a8a42d74cdda21a2ece6f2f7817cfe2326bee9a186344709e23f72` |

The two source-manifest hashes differ only in pathname serialization; the
finalizer compares every entry against the author's seal. Author-owned source
delta is only `src/commands/expr/syntax.ts`. The complete delta from baseline
`27a77935` also includes `src/commands/du/README.md`,
`src/commands/du/arguments.ts`, `src/commands/du/du.ts`, and
`src/fs/overlay/index.ts`. `replay/before.json` retains the full five-path patch,
not an expr-only qualification of the whole package.

## Measured results

| Cohort | Strict or test result | Qualification |
| --- | --- | --- |
| Frozen nine targeted C diagnostics | 9/9 | Original eight plus extension one; actual installed execution |
| Independent native-input holdouts | 25/26 | AST-first counterexample remains a real failure |
| Independent runtime controls | 11/12 | Original output-one assumption remains failed |
| Original full GNU cohort | 97/104 | C 95/95; named UTF-8 locale 2/9 |
| Extension full GNU cohort | 20/23 | C 20/20; named UTF-8 locale 0/3 |
| Separate quoted-parenthesis correction | GNU 1/1 | Does not replace the original extension input |
| Original Apple comparison | 42/104 | Separate dialect, not a GNU acceptance target |
| Extension Apple comparison | 15/23 | Separate dialect |
| Correction Apple comparison | 0/1 | Separate dialect |
| Unchanged old core controls | 146/146 | Bounded installed-runtime/protocol/lifecycle controls |
| Shared legacy regressions | 276/276 | Exact archived 11-file command; zero skips |
| Source-author diagnostics | 71/71 | Separately labelled overlapping suite; zero skips |
| Unchanged expr legacy, first attempt | 235/241 | Two grammar assertions plus four missing-native-prerequisite failures |
| Unchanged expr legacy, qualified rerun | 239/241 | Two grammar assertions remain; zero skips |
| Supplemental harness controls | 42/42 | Does not count nullable native equality as a pass |
| Separate nullable native comparisons | 3/8 | Five failures retained, unchanged inputs/native tuples |
| Optional archived grep-native suite | 50 pass, 2 skip / 52 | Opt-in prerequisites absent; skipped is not passed |

All 256 original/extension/correction **native-to-frozen** GNU and Apple tuples
replay exactly. The independent 26 native expectations also replay 26/26.
Executable, GNU 9.7 version, source, archive member, linked libraries, macOS,
Darwin kernel/architecture, and locale charmaps were requalified against the
original receipts. This is **GNU 9.7 on Darwin, not GNU/Linux**. Native oracle
availability is distinct from candidate parity. Both unchanged GNU comparators
return status 1 because remaining frozen mismatches are retained; the capture
driver's process status 0 means capture completed, not full parity.

The ten remaining GNU locale IDs are original `unicode-length`,
`unicode-substr`, `unicode-index`, `unicode-regex-dot`, `unicode-capture`,
`unicode-combining-not-graphemes`, `unicode-collation`; and extension
`utf8-whole-prefix-span`, `utf8-shifted-first-span`, `combining-first-span`.
The five nullable failures are `empty`, `a`, `aa`, `aaa`, and `mandatory-empty`.
No normalization, denominator change, recapture of a golden, or rebaseline occurred.

### Retained failures and harness repair

The separate frozen counterexample is literal argv `["1","/","0","x"]`:
both statuses are 2 and stdout is empty, but GNU emits
`expr: division by zero\n` while the candidate emits
`expr: syntax error: unexpected argument 'x'\n`. This remains one failed
independent holdout, not one of the requested nine and not silently waived.
A repeated direct observation is labelled overlapping, not a new unique case.
The exact repro was sent to `/tmp/expr-diagnostics-execution-issue.txt`; no source
fix was attempted. Root must route any separately authorized redesign.

The original runtime profile `syntax-output-one` passes `maxOutputBytes:1` and
expects status 2 with the full syntax diagnostic. Actual status is 3 with
`expr: output bytes limit exceeded\n`. This is consistent with the sealed
bounded-diagnostic policy, but the frozen assumption still fails 11/12 overall.
The refusal diagnostic itself exceeds one byte. Neither a universal stderr cap
nor a revised passing expectation is invented.

The first unchanged 241-test run lacked the untracked, relative `.oracle`
prerequisite inside the Git archive. Its 235/241 result, four exact ENOENT
failures, raw output, and command remain in `replay/regressions/expr-legacy241.json`.
`repair-legacy.mjs` then adds exactly one explicitly classified read-only native
fixture symlink under the owned archive. It authenticates the pinned executable,
checks every canonical source/test entry plus the one declared addition, and
runs precisely the same arguments. No test/helper/source byte changes occur.
The symlink is removed afterward and the complete original inventory is restored.
The qualified result remains 239/241: `expr invalid []` and
`expr invalid ["--"]` still reject the measured missing-operand/help diagnostic
using obsolete regex expectations. Those are real failed tests, not test waivers.
Before/bound/after repair receipts and both runs are preserved separately.

Literal native argv0 is `expr` throughout the main frozen/independent probes.
Separate empty/`--` controls show an absolute native argv0 changes only the help
hint pathname: literal comparisons are 2/2, absolute comparisons 0/2. The virtual
label stays `expr`; no native pathname is injected. The runtime binding control
actually registers and dispatches `expr-review-literal` through Shell/registry.
Unchanged author-native tests retain their own absolute-path oracle invocation.

## Safety, integrity, and cleanup

Safety counts are separate from native semantic/diagnostic counts:

- Full frozen candidate replay: 256 contained jobs, 86 real worker-start events,
  256 measured zero-active states before safety cleanup; all outer terminations awaited.
- Nine plus 26 holdouts: 35 jobs, zero worker starts, 35 zero-active observations.
  Runtime controls: 12 jobs, zero worker starts, 12 zero-active observations.
- Core controls: 146 outer terminations awaited; 90 explicit pre-safety counters
  are zero. Nineteen lifecycle counters are zero after their finally cleanup.
  The 45 worker-start events mix real and synthetic transport instrumentation.
- Supplemental controls: 42 outer terminations awaited; 22 explicit pre-safety
  counters are zero; one lifecycle post-finally counter is zero. Its 23 recorded
  start events are not a census of every helper-created thread. Malformed-request
  workers have separate awaited-termination receipts. Missing counters are not
  promoted to universal pre-safety measurements.
- Each old expr run reports 138 abort-reason workers and 20 expr workers, with
  zero active before safety cleanup and afterward. Shared regressions report
  24 actual workers exited, 23 controlled workers inactive, and 17 executor
  workers with zero pre-safety active workers and remaining owned listeners.
- Three extra overlapping binding/precedence probes also report zero active
  workers before safety and awaited outer termination. Harness watchdog selfchecks
  include an intentional spin timeout; this is not a candidate timeout/failure.

Complete source/test inventories authenticate 28,167 candidate and 25,690 older
baseline entries before and after execution, including added paths and literal-tab
names. All 790 candidate and 758 baseline installed files remain unchanged.
Build inputs, archive/package hashes, compiler pins, and full current devtool trees
remain unchanged. Historical tool pins authenticate entry/compiler/package files;
full tree snapshots additionally detect changes, not upstream-signature provenance.
Frozen original eight files, extension/correction sixteen files, all 79 fixed
previous-review files, and the entire historical preparation tree remain unchanged,
including appended-entry checks. This is not a blanket live-checkout clean-state
gate or an append-proof claim for every path in the extracted archive.

All launched commands settled, native scratch removals were recorded, and owned
process-path quiescence was measured before build-root removal. All four owned
archive/moved roots were removed. The native-fixture symlink was already removed.
No global cleanup touched another worker's paths. The exact measurements and
limitations are in `replay/pre-cleanup.json` and
`replay/final-integrity-cleanup.json`.

Measured archive/execution window starts `2026-08-27T18:45:31.835Z`; final cleanup
completes `2026-08-27T18:52:58.336Z`. This records actual bounded work, not 72 hours.

## Evidence entry points and limits

- `replay/summary.json`: separate denominators, raw-output receipt paths, commands,
  source identities, failure classifications, and safety counts.
- `replay/acceptance-diagnostics/`: original/extension/correction reports and exact
  stdout/stderr base64 tuples, comparisons, runtime traces and import graph.
- `replay/independent-first/independent.json`: immutable nine/26/12 execution,
  original expectations, failures, installed import traces and worker receipts.
- `replay/distribution-diagnostics/`: strict actual-installed declaration trace,
  plain-Node smoke, declaration contents, worker dependency graph and package exports.
- `replay/regressions/`: exact archived commands, raw stdout/stderr/status,
  first failure, local harness repair, qualified rerun, and overlap-labelled suites.
- `replay/final-inventory-*.json`: complete source/test and installed inventories.

Capture scripts are version-specific explicit review tools, not canonical tests.
Their recorded temporary stage paths have been removed; a future execution must
bind fresh unique output directories and rebuild fresh archive stages. No claim
is made of full expr completion, root integration, full gate, deployed-service
acceptance, universal parity, superiority, or deduplicated total test coverage.
