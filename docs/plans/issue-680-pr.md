# Issue 680: bounded GNU pr

## Requirement and reference

Implement `pr` pagination, headers and columns, including `-COLUMNS`, `-h`,
`-l`, `-w`, `-t`, `-n`, `-m` and `-s`. Preserve exact native output bytes and
statuses for the qualified Linux profile. Bound input, retained memory, pages,
columns, output and work; use only supplied virtual filesystems and cooperative
cancellation. Do not add a native process, network or implicit host-file fallback.

The original reference is GNU coreutils 8.30, Ubuntu 8.30-3ubuntu2, applied
source commit `26a1fa64acd11d62b28a59fab6b938ab57d12ba7`. The complete 2,847-line
`pr.c` has SHA-256
`cc8fdf01d300949bb1c4235b26b5c99359556294e0bded7174f08085b7aeaea1`.
The initial qualification captures 50 bounded C-locale/UTC native invocations
in `/home/kjopek/project/poe-code-unit-55fyhF/issue680-pr-glNtzj/results.json`:
41 exit zero and nine expected errors; none timed out or received a signal.
This is a finite reference profile, not all GNU versions/locales or universal parity.

## Design and ownership

Use a dedicated byte-oriented reader, pagination and column formatter rather
than adapting `column`: their native width, tab, balancing and formfeed rules
differ. Qualify header timestamps against file metadata and an injected clock;
do not invent host timezone or locale support. Preserve NUL, CR and high bytes.
Retained source chunks must be owned before advancing producers; sink writes
must respect backpressure and cancellation, including falsey reasons.

The command author owns `src/commands/pr`, its focused tests and `docs/PR.md`.
An independent reviewer owns separate oracle/adversarial tests. Root owns
integration, this plan, discovery, final gates and Git delivery. An inventory
worker updates explicit maintained consumer expectations without modifying
sealed historical cohorts. No README additions are authorized.

Expose `createPrCommand`, `createPrCommands`, `prCommands`, `PrCommandsOptions`
and `PrLimits`; append `pr` after `csplit` in the default preset. Forward limits
and the injected clock through `AgentCommandsOptions.pr`, retaining one aggregate
replacement policy. Root and scoped command subpaths must support Node and
portable browser/workerd builds with shared factory identity.

## Test-first milestones

1. Reproduce missing public registration and saved-script behavior before wiring.
2. Compare native byte/status fixtures for downward balanced columns, merge,
   attached optional arguments, number overflow, separators, width/truncation,
   unterminated lines and formfeeds. Preserve erroneous probes separately.
3. Qualify header clock sampling, multiple file timestamps and page transitions.
   Reject unsupported configurations explicitly rather than silently reducing
   requested behavior or reconstructing raw content through lossy text.
4. Test limits before allocations, copied input ownership, rejected and stalled
   sinks, cancellation, missing/directory operands and virtual script execution.
5. Run independent stress review, maintained discovery, full tests and lint,
   normal build, strict types, committed-archive and fresh packed consumers.
   Inspect a terminal screenshot for the formatting change. Distinguish a
   browser-platform bundle executed in Node from an actual browser execution.

Commit this atomic improvement only with its implementation and relevant plan.
Verify remote main delivery before closing #680, then monitor actual publication
while continuing the next validated issue. Prior macOS exclusion remains in force.

## Initial public regression

Three public regressions fail against the pre-implementation source: missing
preset/factories, saved-script balanced columns and numbered merge. The real
individual-case report is `/tmp/issue680-public-red-v2.log` (zero pass, three
fail). The preceding sandboxed run reports only one file-level failure and is
preserved separately; it is not three-case evidence.

## Integration checks

The public integration now passes five individual tests in
`/tmp/issue680-public-integrated-v1.log`, including injected clock forwarding,
ignored nested replacement configuration and input-limit forwarding.
Maintained discovery passes 100 tests in `/tmp/issue680-discovery-v1.log` and
explicitly includes the seven initial pr test files. Any additional reviewer
tests must be added to the literal discovery assertions before final gates.

Independent consumer/inventory updates cover 24 existing files, including the
six initially missed current inventory assertions. Their focused regression
retains 11 failures followed by 11 passes; sealed original cohorts are unchanged.
The broader source-only checks pass 622 Node cases and 45 source/mock browser
and metadata cases, without skips, in
`/tmp/issue680-owned-source-inventories-v1.log` and
`/tmp/issue680-owned-source-browser-metadata-v2.log`.
The two playground dist consumers and packed runtime/type checks are deferred
until the final normal build. These source checks are not final delivery proof.

## Independent boundary findings

The initial command-author freeze passes 116 tests (80 exact native cases and
36 API/safety cases) plus focused types. Independent review passes 110 of 123
tests; the remaining 13 validate shared defects: five enrolled-stdout writes
settle early through shell wrappers, and eight canceled DeviceFileSystem stream
acquisitions still start a read. No failure is waived or called a pass.
Separate generic test-first fixes are described in
`docs/plans/owned-output-drain-20260910.md` and
`docs/plans/device-stream-acquisition-20260910.md`. Recheck the unchanged reviewer
corpus after fixing both boundaries and refreshing canonical built dependencies.

## Visual inspection

An actual saved virtual `workflow.sh` exercises balanced columns, numbered merge
with a multi-byte separator and a fixed-clock report header. It exits zero with
empty stderr. Its output was rendered with the repository's terminal PNG renderer
and visually inspected: aligned columns, readable numbering, centered report
heading and page footer spacing. Artifacts are `out/issue680/terminal-v1.txt`
and `out/issue680/terminal-v1.png`. This is a local terminal rendering, not a
real-browser execution, and does not replace byte-level comparisons.

The first normal refresh build rejected root's aggregate forwarding object under
exact optional-property types: it supplied explicit `undefined` fields to the
new pr options. The failing build is preserved in
`/tmp/issue680-build-refresh-v1.log`. Root corrected the forwarding object to
omit absent fields, retaining one read per selected option and never reading a
nested replacement property. This was an integration defect, not a waived gate.

## Frozen pre-delivery qualification

After the final DeviceFS getter fix and normal refresh build v3, the unchanged
independent corpus passes all 123 cases, with no skips or cancellations, in
`/tmp/issue680-pr-independent-green-v1.log`. All 13 original shared-boundary
failures resolve. Focused independent types pass in
`/tmp/issue680-pr-independent-types-v6.log`; this remains finite-profile evidence.

The shared fixes have separate local commits:
`2976a14f6825671b4c2c39db9ed8ec37df9e74ca` for device-stream acquisition and
`e8a60eb2662d0cea50f5ff3c96be2f1e3eee8f3b` for enrolled-output draining.
The feature consumes that lineage rather than working around either boundary.

The normal refresh build v3 passes all 70 declared workspace builds plus root
suffix stages. Maintained typechecking passes source/tests and 26 consumer groups,
including three expected-rejection compiler profiles; it executes no runtime
cases. Package lint passes all 17 rules. Root lint v2 passes before the last
packed-fixture enhancement and must be repeated against final inputs.

Both shared fixes now have portable public-consumer checks inside the existing
pr packed workflow: held enrolled stdout must drain before exact false-abort
settlement, and an aborting DeviceFS `next` getter must admit no pull while its
single return drains. All 15 source/mock browser tests pass in
`/tmp/issue680-pr-shared-packed-canaries-source-v1.log`; the other 23 consumer
fixtures remain byte-unchanged. Final input manifest v3 binds 53 code/test/config
files. Full maintained tests, final lint/build, committed-archive and fresh packed
qualification remain mandatory before any push. A local commit is not delivery
or a successful release.
