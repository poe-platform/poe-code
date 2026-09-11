# Symbol registry accounting

On the built symbol-registry snapshot candidate, run each source and measure
the returned intrinsic with measureSandboxData([result.returnValue]):

```js
Symbol.for("x".repeat(200));
return Symbol;
```

Measured 774 units. Replacing the return expression with Symbol.for or
Symbol.keyFor measures only one unit, although each alias retains the same
registry. The constructor has a retainedValues callback; the aliases do not.
This is a validated accounting omission for escaped intrinsic method values,
not proof of a live-run budget bypass.

The registry snapshot change supplies weak origin metadata for all three
intrinsics. Use that identity to account for retained registry entries once
per measured graph, including aliases without the constructor. Avoid double
charging when several aliases share the registry. Preserve key strings,
registered-symbol identity and nested restored closures. Reproduce with failing
measurement tests before implementation, then test original and restored values
and unchanged ignoreClosures/ignoreClosureCaptures semantics.

This remains separate from the pending registry snapshot delivery. Do not claim
all symbol registry resource accounting is solved by snapshot fidelity tests.

Implementation direction: reuse the existing sandbox Map representation for
the private registry's retained data. Constructor and original for/keyFor
closures can retain the same registry object; measureSandboxData already
accounts for Map entries and deduplicates shared graph objects. This avoids
adding another origin-map lookup to every measured closure in the hot path.
The registry is internal, not a new guest-visible object or API. Keep snapshot
origin metadata pointing to its entry map so restoration populates the same
retained storage. Validate that graph sharing prevents duplicate charges and
that ignored closure captures remain ignored.

Snapshot fidelity was committed and verified on remote main as 44df48515 before
this separate implementation began. Three new accounting regressions failed at
one measured unit. The private registry now uses shared sandbox Map storage,
retained by the constructor and original for/keyFor closures. No hot-path
measurement dispatch was added. The three regressions now pass, including shared
graph deduplication and both closure-ignore options. All 83 focused symbol,
descriptor and direct-registry-restoration checks pass in 2.73 seconds.

This accounting candidate is uncommitted. Still require restored-alias accounting
checks, lint/types, package regressions, normal build and real CLI validation.

Restored-alias accounting now has an explicit regression: restoring bare
for/keyFor aliases preserves the original measured usage; a new 300-character
key adds exactly 602 units (key text, symbol and entry), and a repeated lookup
adds nothing. All 84 focused symbol/registry checks pass in 2.85 seconds.

Changed-file lint and TypeScript diagnostics pass. The normal build completed
all 70 declared workspace build tasks and root stages, including four fresh
SafeJS import checks. The existing symbol-registry harness passed through the
real CLI with zero spawns; its new screenshot was inspected. Built-SDK probes
on Node 18.18.0 measure each escaped alias at 404 units for a 200-character key,
instead of the baseline one unit.

Started the maintained package regression route with the same two explicit
experimental exclusions: the weak-collection feature probes and host-promise
property-admission probe. Those gaps are not claimed solved or passing. All
committed package coverage and the new accounting regressions remain enabled.

Final regression result: 618 files passed, one skipped; 19,528 tests passed,
41 skipped, no failures, in 345.96 seconds, with the two explicit experimental
exclusions above. All delivery checks are complete for this accounting change.
