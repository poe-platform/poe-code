---
title: Iterator.from wrapper validation
---

# Iterator global and helpers

Validated against the built SDK after the RegExp iterator prototype implementation:
`typeof Iterator` and `typeof [1,2].values().map` both return `undefined`;
`Iterator.from([1,2]).next()` fails with `UNBOUND_IDENTIFIER` for `Iterator`.
These probes did not mutate implementation or replace regression tests.

The subsequent isolated native-comparison baseline in iterator-global.test.ts
failed all 12 cases in 1.33 seconds against main 5738603a7. Coverage includes
constructor metadata and rejection, subclassing, shared prototype identity,
from identity/string/wrapper behavior, cached next lookup and return receiver.
Implementation has not started. An initial package-script invocation appended
the file without narrowing the script's existing directories; that overly broad
run was deliberately terminated and is not verification evidence.

Specification baseline: https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#sec-iterator-objects

Implement the standard abstract, subclassable constructor and Iterator.from,
including direct iterator records, string input, identity preservation and the
branded wrapper's next/return behavior. Extend the existing shared iterator
prototype rather than creating disconnected parallel prototype graphs. Validate
constructor and wrapper behavior with failing native-comparison tests first;
cover retained state, budget enforcement and snapshots before delivery.

Then implement and verify the lazy and consuming iterator helpers, including
observable callback order, closing, abrupt completion and lazy cursor replay.
Each independently validated improvement gets its own commit and push to main.
Do not treat constructor/from support alone as completing the broader helper gap.

Wrapper follow-up coverage now also targets argument suppression, deferred
non-callable next errors, dynamic return lookup, no synthetic exhaustion after
return, shared methods and wrong-receiver branding. The cached-next probe uses
Object.defineProperty to replace the getter, avoiding an unrelated sloppy-mode
assignment discrepancy with SafeJS's strict semantics. The expanded tests have
not yet been run; the constructor package verification is running separately.

After constructor delivery at 2f815d6a6, the expanded baseline ran: 13 failures
and six passes in 1.47 seconds. Failures confirm missing from metadata, identity,
string/direct wrapping and wrapper methods. The six passes include constructor
controls and a TypeError case that also passes when from itself is missing;
that case alone is not evidence of correct from input validation.

Iterator.from now obtains the iterator and cached next in observable order,
preserves Iterator instance identity, and wraps other objects with branded,
shared next/return methods. The initial combined constructor/from check passed
35 tests. New integration tests then exposed two real gaps: private state was
not charged (1 unit rather than at least 200) and low-level snapshots lost the
wrapper brand. A dedicated iterator-wrapper heap node and retained-state budget
traversal corrected those failures; 38 combined tests then passed in 1.75 seconds.
Package production TypeScript passed. Additional restored-cursor execution and
malformed-state checks are being verified before broader checks and delivery.

Expanded focused coverage passed 87 tests across four files in 2.41 seconds.
Scoped ESLint, package production TypeScript and root lint:types passed. The
normal workspace build and all four built-import checks passed. The real paired
harness passed and its screenshot was inspected (zero spawns; no model claim).
Node 18 built SDK execution and public replay retained cached next and wrapper
identity. The low-level snapshot fixture required an explicit RuntimeSnapshotValue
annotation; the new test file then had zero TypeScript diagnostics.

The package-wide run (only host-Promise probe excluded) passed 19,308 tests
but failed four exact-step-budget cases in three files, with 41 skips, in
330.59 seconds. The wrapper prototype installer passed the guest budget into
setSandboxPrototype, charging an installation step. Removing that argument for
intrinsic installation matches existing prototype installers; runtime wrapper
allocation still uses the budget. No step limits or assertions were changed.
The targeted rerun then passed all 89 tests across four files in 2.46 seconds.
Final rebuilt harness and package-wide rerun remain required before delivery.

After the step-accounting fix, final lint passed. The CLI rebuild completed
70 uncached tasks in 65.038 seconds; the harness passed and its new screenshot
was inspected. Node 18 built checks passed for an exact two-step script,
cached wrapper next and public dump/replay. The clean package rerun is running
with only the documented host-Promise probe excluded.

The final package rerun passed 19,312 tests across 605 files in 323.42 seconds,
with 41 skipped tests and one skipped file. The host-Promise probe exclusion is
not a pass. This delivers Iterator.from; all eleven helpers remain explicitly
tracked in safejs-iterator-helpers.md and are not claimed complete here.
