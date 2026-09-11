# Issue 687: bounded ZIP creation and extraction

## Scope and delivery

Implement `zip [-r] ARCHIVE FILES…` and
`unzip [-l] [-o] [-d DIR] ARCHIVE [FILES…]` in the existing archive command
family. Preserve tar behavior and expose the same factories/options through the
public source, Node, browser, workerd and scoped-package surfaces. ZIP commands
are VFS-only; native Info-ZIP programs are comparison oracles, never fallbacks.
Resolve this issue first, then continue the remaining kamilio issue queue.
The explicitly excluded macOS issue remains excluded; no Poe2 work is required.

## Ownership

- Format worker: ZIP record parsing/writing, CRC and raw-DEFLATE codec, with
  in-memory malformed-record, budget and cancellation tests.
- Extraction worker: unzip argument/list/selection/prompt behavior, confined
  extraction and decompressed-byte charging, with focused tests.
- Creation worker: zip argument/traversal/update/publication behavior, bounded
  source acquisition and output charging, with focused tests.
- Source reviewer: finish exact-version original-source/helper scrutiny and
  report semantic invariants independently of the implementation.
- Root: public registration, independent inventories, saved-script workflows,
  consumer packaging, adversarial review, final gates and atomic delivery.

## Safety and compatibility

Reject absolute, parent-traversing and malformed effective or original entry
names; enforce destination-parent and symlink-target confinement. Admit bounded
archive/member/path/count/depth/argument/metadata sizes before retained work.
Verify central/local consistency, CRC, compressed exhaustion and actual decoded
length. Charge actual decompressed bytes before retention or publication, not
only advertised sizes. Keep cooperative work checkpoints and original caller
cancellation reasons, including falsey reasons. Preserve unrelated entries on
ordinary ZIP update and prevent archive self-inclusion through backing aliases.

Use the installed Linux Info-ZIP profile and its exact applied source revisions:
Zip 3.0-11build1 (`eb4e9ee95576e693e35046ba3be5035534c6c46d`) and UnZip
6.0-25ubuntu1.2 (`0b70449659817f18122d09ecdf8dbd11d7501b1e`). Prior bounded
source captures live in `/tmp/issue687-source-2tugy7zf`; preserve those bytes.
Compare status, stdout, stderr, extracted bytes and namespace effects without
normalization. Do not describe stronger confinement or explicitly unsupported
formats/options as native-equivalent. Compressed archive bytes, metadata and
timestamps need their own exact comparisons, not merely round-trip assertions.

## Gates

Start with concrete failing public and command tests; retain red evidence beside
green results. Unit fixtures remain in memory. Run focused malformed/archive/
budget tests, independent native comparisons and source review, maintained
inventory/type/lint checks, then normal build and complete maintained unit route
for the cross-workspace command integration. Verify freshly packed consumers
under Node, Bun and the portable build; visually inspect the saved-script
workflow in the actual browser. Preserve every failed attempt and qualify only
the actual checked revision. Push an atomic fix to main, verify remote delivery,
close the validated issue, continue the next issue while monitoring release
through actual publication rather than a green no-op.

## Source scrutiny and intermediate evidence

The additional pinned source receipt is
`6cb7e47fa8b3bea31a2c977aa4b03f8d8106574be25bddc4f3fc33864fee3978`
under `/tmp/issue687-source-resume-_bmx55k0`; the original receipt remains
`7124e108a6078839b43065764ed343eb1b6690a344de9c15d4f5d835871c1ec3`.
The audit covers Zip's main body (2119–6018), active regular scanner, local and
central writers, ordinary update copying, Unix timestamps and relevant UnZip
EOCD, extraction, metadata and display routines. Generic option-parser internals,
complete charset/compressor implementations, repair/split paths and full headers
are not wholly audited. These are source-integrity receipts, not reproducible
binary-equivalence claims.

Initial public tests fail because ZIP commands are absent. The corrected public
cohort passes 13 cases; malformed CRC fixture construction and Buffer-versus-
Uint8Array expectation mistakes are preserved in their earlier failed logs.
The integrated format/extraction/public cohort passes 92 cases in
`/tmp/issue687-focused-v1.log`. Maintained discovery passes all 100 cases in
`/tmp/issue687-discovery-v2.log`; v1 preserves the sandbox child-launch failure.
Independent literal inventories agree on 91 default commands, with 32 selected
inventory/collision/current-profile tests passing. These are focused results,
not the full unit gate.

Independent adversarial review reproduces and drives fixes for DOS local-time
reading/writing and upward two-second rounding, staging-symlink metadata escape,
raw invalid-UTF-8 argument aliasing, and admitted-work lifetime. Ordinary ZIP
update partial-write failure is checked against native temporary-file-before-
replacement behavior. Every red cohort remains beside later results; no test
timeout or failure is counted as a pass.

Native Zip comparisons have 15 of 17 exact stdout/stderr/status matches; two
recursive cases expose provider traversal-order differences. Replaying a supplied
native order is a separate qualified observation, not a rewrite of those original
failures. Native UnZip accepts 12 generated archives with its integrity check;
this does not establish identical ZIP container bytes. Extraction has 21 native
spots, including a separate exact 12-case edge replay. Format limits remain
explicit: no ZIP64, encryption, alternative compression methods, SFX/trailing
records, dot/repeated-separator normalization, or locale-dependent legacy-name
equivalence claim.

The actual saved-script VFS workflow is visually inspected using the local
terminal PNG renderer: `out/issue687/terminal-v1.png`, with raw transcript next to
it. This uses no browser or credentials. The separate watchable-browser operation
was denied because it accesses another project's credential store; explicit user
approval was requested. No browser session was created, and no real-browser
validation is claimed. The portable bundle consumer remains a distinct required
runtime check.

The normal workspace build passes in `/tmp/issue687-build-v2.log` after the first
attempt's sandbox TSX IPC refusal. That build precedes the final retained-cleanup
integration and does not qualify subsequent edits. The first complete unit-route
attempt stops at three real-filesystem lint fixture failures: the shared `/tmp`
directory exceeds the unchanged 30,000-entry admission cap. The original run has
22,396 passing and three failing tests at that stage; later workspace stages did
not run. With a task-owned `TMPDIR` under `out/issue687`, all 278 lint tests pass
without changing guards or assertions. That initial temp root is recorded in
`out/issue687/unit-temp.path`; subsequent isolation failures require the external
replacement described below, not reuse of the checkout-local directory.

Actual Shell cancellation also demonstrates that ordinary scoped filesystem
operations cannot remove owned staging entries after their captured signal
aborts. Retained-work draining alone is insufficient. The separate retained
filesystem cleanup plan addresses this API boundary; do not weaken temporary
namespace assertions or bypass scoped accounting to turn these reds green.

## Final integration checks

The frozen production inputs pass the normal build in
`/tmp/issue687-build-v5.log`, including the post-build twelve-file hash check.
The maintained source and 26-group consumer type route passes in
`/tmp/issue687-types-v3.log`; its three negative fixtures deliberately reject
invalid programs, rather than being runtime successes. All 17 package lint rules
pass in `/tmp/issue687-package-lint-v1.log`. Literal discovery, now including the
actual Shell retained-cleanup regression test, passes all 100 cases in
`/tmp/issue687-discovery-v3.log`. These checks do not replace the complete unit
route, repository lint, fresh packed consumers or publication verification.

Repository lint, TypeScript and workflow checks pass in
`/tmp/issue687-lint-v5.log`: 10,542 configured/linted files, no errors or warnings.
The second full unit attempt exposes a separate real Vitest fixture inheriting
ancestor configuration from the isolated temporary directory. Its existing two
cases remain unchanged; explicit fixture-local configuration fixes discovery.
That independent change is delivered as
`df24f822261455c9b8bb2bbc616a2b841bf226a0`, verified on remote main. The third full
attempt passes 22,445 shared Vitest cases, 29 Python cases and 303 Bash runner
cases before entering the 706-file Bash task. These intermediate counts do not
claim that the final task or whole route has finished.

The first fresh packed Node/Bun consumers and runtime/type probes pass, but its
browser-platform bundles fail: the packed `core.browser.js` is the compiler's
67-byte wrapper rather than the portable bundle. This is traced to validation
ordering: the maintained unit route first rebuilds SafeFS and virtual-bash,
overwriting artifacts produced by the earlier normal build. The wrapper's
02:46:47 UTC modification time matches that dependency-build stage. Root
`scripts/bundle.mjs` publishes the actual portable bundle in the normal build's
suffix stages; the unit route does not run those suffix stages.

Preserve `/tmp/issue687-packed.R0xCIj` as the failed artifact-profile evidence.
After the complete unit route settles, run the normal build again and then fresh
packs and all consumer profiles, with no intervening dist-mutating test/build
commands. Unchanged source hashes do not prove unchanged generated artifacts.

The third full route finishes the Bash task with 27,587 passes, seven failures
and 63 skips out of 27,657 tests. All seven failures are isolation controls:
checkout-local temporary consumers can resolve missing dependencies and buffer
types from the ancestor repository's `node_modules`. Do not relax origin,
missing-dependency or continuity assertions to accommodate that environment.

An explicitly approved task-owned scratch directory outside both the checkout
and the crowded `/tmp` ancestry is recorded in
`out/issue687/unit-temp-external.path`. All 194 archive/writer isolation tests
pass there unchanged in `/tmp/issue687-external-temp-isolation-green-v1.log`;
all 279 real lint and Vitest fixture cases pass in
`/tmp/issue687-external-temp-root-green-v1.log`. The complete fourth attempt uses
that external root. No unavailable or skipped profile is counted as a pass.

The complete fourth `npm test` attempt exits zero, including declared native
pre/post lifecycle stages and final lint stress. Actual passing cohorts are
22,445 shared Vitest cases, 29 Python cases, 303 Bash runner cases, 27,594 Bash
cases, 21,659 SafeJS cases, 288 terminal-pilot cases and two lint-stress cases.
The shared/Bash/SafeJS skips remain respectively 1/63/37, not passes. The raw log
is `/tmp/issue687-full-test-v4.log`. Normal build v6 runs afterward to restore
release artifacts; fresh packed profiles still require independent verification.

Normal build v6 completes successfully in `/tmp/issue687-build-v6.log`, retaining
all twelve production hashes and producing the 2,137,414-byte portable entry.
The rebuilt artifacts pass all 17 package lint rules and the maintained 26-group
source/consumer type route in `/tmp/issue687-package-lint-v2.log` and
`/tmp/issue687-types-v4.log`.

Fresh v6 scoped/root tarballs pass all 22 runtime, bundle and type invocations in
`/tmp/issue687-packed-v6.bMxoMk/results.tsv`. Node and Bun run the maintained
smokes, ZIP saved-script workflow and explicit public cleanup probes. All four
browser-platform graphs have zero external imports and resolve inside their
isolated consumers; their bundles run in Node, not a real browser. Both strict
NodeNext and browser-condition type profiles pass. Before/after checks preserve
8,766 packed-closure entries, 5,324 repository build inputs and the twelve
production hashes. Full commands, integrity records and bounds are in that
directory's `REPORT.md` and `commands.log`. Offline lifecycle-free installs omit
optional native dependencies; these profiles do not claim their coverage or
complete Info-ZIP equivalence.
