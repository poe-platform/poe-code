# Object.prototype.toString and Symbol.toStringTag

## Evidence and scope

Native comparisons showed that custom tags were ignored and getters were not
called. Controls cover own/inherited tags, getter receiver and ordering,
throwing getters, non-string fallback without coercion, function fallback,
primitive wrappers, Symbols, arguments and nullish receivers.

The first async-function fixture attempted assignment over an inherited
read-only tag; it was corrected to define an own property. This was a fixture
error, not a runtime issue. Node 22 also differs from the target specification
for primitive tag-getter receivers. The implementation follows
[ECMA-262 2026, 20.1.3.6](https://tc39.es/ecma262/2026/multipage/fundamental-objects.html#sec-object.prototype.tostring):
convert the receiver to an object, then read its tag. The primitive receiver case
therefore has an explicit normative assertion rather than copying Node's result.

## Implementation

Read the tag through the existing sandbox descriptor/accessor machinery. Accept
only a primitive string; otherwise retain the internal-slot-based fallback.
Keep inherited virtual tags for built-ins whose prototype graphs are still
incomplete, but do not use those virtual tags after an explicit prototype change
or an explicit non-string tag. Do not expose host capability symbol metadata.

## Verification

All 87 focused controls passed. The maintained SafeJS package suite passed
13,932 tests with 41 skips; TypeScript and focused ESLint explicitly exited zero.
Evidence: /tmp/poe-safejs-to-string-tag-red.log,
/tmp/poe-safejs-to-string-tag-first.log,
/tmp/poe-safejs-to-string-tag-focused.log,
/tmp/poe-safejs-to-string-tag-package.log,
/tmp/poe-safejs-to-string-tag-types.log and
/tmp/poe-safejs-to-string-tag-eslint.log.

Before delivery, build the selected SafeJS workspace closure and run/inspect
the real harness screenshot. Commit and push this change separately, verify
remote main, and monitor publication while continuing the remaining gaps.

The preceding descriptor fix (0777629171caac77f2099babbda02468020900b7) is
verified on remote main and published as @poe-platform/safe-js@0.1.160 by run
34024062565. CLI run 34024062779 failed on the million-element spread-test
timeout; the independent spread-cost fix is documented in safejs-large-spread-test.md.
The foundation's earlier
CLI run 34023765719 was cancelled, not counted as a successful publication.

## Harness integration finding

The selected workspace build passed, including all four fresh-process import
checks. The screenshot command exited zero because it produced an image, but
visual inspection showed that the harness itself failed: AS011 still rejects
Object.prototype access. This is not a passing QA result. Three new failing
lint controls independently reproduce rejection of Object.prototype, a guest
function's prototype, and an ordinary data property named constructor.

The interpreter already supports these accesses. Before delivery, align the
default linter with the runtime's guest-object model and verify that host-object
and host-function boundaries still deny native prototype escape. Do not use a
lint suppression or computed-key workaround in this fixture. Evidence:
/tmp/poe-safejs-prototype-lint-red.log and
/tmp/poe-safejs-to-string-tag-screenshot.log. The current toStringTag work remains
uncommitted until this integration check passes.

## Integration resolved

The lint correction is now verified on remote main as
85bd9ef27c9896f18aa1d0e8a40380d8d0190b38. The final foundation harness screenshot
was inspected and shows Harness passed, readable results, and zero spawns
(/tmp/poe-safejs-to-string-tag-screenshot-final.log). The current combined package
suite also passed 13,926 tests with 41 skips after the independent spread fix;
that check is recorded in /tmp/poe-safejs-large-spread-package-final.log.
This resolves the integration prerequisite for this separate runtime commit.

Publication remains distinct from delivery: spread CLI run 34025002234 was
superseded/cancelled, scoped run 34025002131 was still in progress, and lint
release runs 34025021268 / 34025021097 were queued or pending at this check.
