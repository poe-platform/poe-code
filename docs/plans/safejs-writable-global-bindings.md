# Writable built-in global bindings

## Validated gap

On c029ad482, built output rejects assigning Math or JSON with a TypeError
stating that the binding is const. A native Node control accepts Math = 7.
Scope currently initializes every supplied binding as const, including the
built-in root installed by run. New regression tests cover writable built-ins
and preserve read-only globals and injected host bindings as controls.

Session 2522 reproduced five failures for Math, JSON, Array, Object and Promise,
with three passing controls for an injected host binding, Infinity and NaN.
A native descriptor probe confirms those five globals are writable/configurable,
while Infinity, NaN and undefined are non-writable/non-configurable. No runtime
change has been made for this gap yet.

## Implementation requirements

- Permit replacing standard writable built-in bindings without exposing host
  globals or changing injected binding mutability.
- Preserve immutable Infinity, NaN and undefined semantics.
- Keep changes isolated between runs and preserve lexical shadowing.
- Retain replacement values for data and compilation accounting, including
  values reachable only through a replaced global binding.
- Preserve replacements in escaped closures and snapshot round trips, with
  strict validation of any new scope metadata.
- Do not charge the entire pristine intrinsic realm merely to make its binding
  slots writable. Existing intrinsic-property mutation accounting already
  tracks changes relative to installed descriptors; examine that mechanism
  before introducing a second accounting policy.
- Keep globalThis/object-environment support as a separately validated change;
  writable identifier bindings alone do not complete global-object semantics.

## Delivery

Use failing tests before implementation, selective maintained validation, a
separate conventional commit and direct main push. Continue monitoring the
resource-declaration release while working on this change. No implementation
or delivery of writable globals is claimed yet.

Resource declarations are delivered as c029ad482942e96dde9c4a6264ff2a54f09014f6,
verified on remote main. Its scoped release is run 34188818936 (publish job
101942478656 observed in progress); the CLI release is run 34188819065. Neither
workflow's successful publication has been verified yet.

## Candidate implementation and verification

The expanded baseline run (1767) reproduced eight failures, with four passing
controls. Built-in binding records now carry installation metadata identifying
writable names. Scope uses that metadata only for actual built-in installation
records, leaving normal/injected constructor bindings const. Existing var-cell
snapshot metadata preserves mutability without introducing a new wire field.

For uncharged intrinsic scopes, a small set tracks replaced bindings. Pristine
values are recognized by trusted intrinsic identity, while replacement values
remain visible to data and compilation accounting. Hydration reconstructs that
set from the existing binding cells. Returning a slot to its original intrinsic
removes the extra ownership, without charging the pristine realm.

Focused verification passed 52 scope/binding tests, then 13 binding/snapshot
tests, then 60 realm/accounting tests. The expanded run 45022 passed 129 tests
across ten files. Coverage includes repeated JSON round trips, persistent realm
evaluations, independent runs, lexical shadowing, readonly controls and an
aggregate-budget rejection for data retained only by replacement globals.

TypeScript, candidate ESLint (4535), whitespace checks and the maintained
23-workspace build (45139) passed, including four fresh-process built-import
checks. Built core.js smoke checks passed on Node 18.18 for mutable and readonly
globals, run isolation and persistent-realm replacements. A full frozen-input
safe-js regression run remains before delivery; no new exclusions or relaxed
timing limits are authorized.

The resource-declaration scoped release is now verified: workflow 34188818936
succeeded and its publication log records @poe-platform/safe-js@0.1.427 at
2026-09-08T05:02:16.0100664Z. CLI workflow 34188819065 was still running its unit
job 101943113142 at the last check. Writable globals are not committed/pushed yet.

The frozen full run 5860 finished with 19,930 passing tests, 41 skipped tests
and one failure: the object-registry three-replay case in
namespace-identity-mc-002-validation.test.ts exceeded the existing 5-second
limit. Its complete 18-test file then passed unchanged in session 34586;
the affected case took 1,553 ms and the map control took 1,695 ms. A read-only
process check showed multiple unrelated browser processes consuming roughly
one CPU each. This is evidence of concurrent load, not proof of the timeout's
cause or permission to terminate those processes. No fixture, timeout or
exclusion was changed. Repeat the unchanged full gate before delivery; a
focused pass alone does not replace it.

Repeat frozen run 79255 passed: 668 files passed, one skipped; 19,931 tests
passed and 41 skipped, in 423.96 seconds. Inputs, limits and the two previously
documented exclusions were unchanged. The original timed-out case passed.

CLI workflow 34188819065 subsequently failed. Its two-pending-promise harness
recovery case reproduced locally in session 5388 (seven controls passed), with
SnapshotNotReadyError from active promise-reaction capture. This is a separate
resource/snapshot integration regression, not a writable-binding assertion;
investigate it immediately after this atomic delivery. CLI publication is not
claimed.
