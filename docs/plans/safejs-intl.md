# Intl implementation

## Scope

Implement the missing Intl namespace and its standard APIs without exporting
native objects or letting native ICU invoke guest getters. This is one part of
the broader JavaScript compatibility goal, not a replacement for it.

The [ECMA-402 catalogue](https://402.ecma-international.org/#sec-intl-object)
includes two namespace methods and Collator, DateTimeFormat, DisplayNames,
DurationFormat, ListFormat, Locale, NumberFormat, PluralRules, RelativeTimeFormat
and Segmenter. Constructor instances need guest-owned internal state, method and
prototype semantics, budget accounting and portable snapshots. Node 18 remains
supported; missing native DurationFormat must not silently remove that API or
raise the runtime minimum. Formatter/Locale support remains future work after
the namespace-method commit, with its own validation and atomic deliveries.

## Namespace methods

Reuse the existing `canonicalizeGuestLocales` implementation shared by string,
number and date locale methods. It performs guest property/coercion operations
before primitive locale strings reach ICU. This follows the specification's
[CanonicalizeLocaleList](https://402.ecma-international.org/#sec-canonicalizelocalelist)
ordering, including inherited indices, holes and early invalid-tag rejection.
Future Locale instances must add their internal-slot path to this shared helper.

Expose getCanonicalLocales and supportedValuesOf as guest intrinsic functions,
with standard names, lengths, descriptors, namespace tag and mutable properties.
Only a converted primitive key reaches native supportedValuesOf. Allocate results
through the sandbox budget. Register namespace/method identities so the existing
snapshot machinery preserves mutation and aliases. Add Intl to maintained global
lint declarations.

## Evidence

- Initial 24 tests all failed on the missing namespace.
- Implemented namespace methods using existing locale coercion and intrinsic
  registration; 61 tests passed including known-global validation.
- Added result-array budgets and pending/completed mutation replay controls;
  all 28 Intl tests pass.
- Native comparisons execute in separate vm contexts so property-mutation
  controls do not modify the test process's native Intl methods.
- Build 56119 and lint 42302 are running. Full regression, downstream and Node 18
  checks are required before the namespace-method commit and push.
- No claim that Intl constructors or the wider compatibility goal are complete.

Build 56119 passed 23 workspaces and four fresh-process imports. Node 18 built
namespace methods matched its native canonical locale and calendar results.
Lint 42302 reported two unnecessary escapes in the vm test string; corrected
them and started standalone lint rerun 61774 (the previous shell's final diff
check masked lint's exit status, so that first run is not recorded as passing).
Full suite 52451 is now running with source/tests frozen, log
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-intl.MtgCkXlRvi`.
Only the same two previously documented experimental files are excluded.
The grouped-scope releases 34210199372/34210199821 are active. Older host-function
CLI run 34208993436 was cancelled after main advanced; host-function scoped
publication remains verified as SafeJS 0.1.444.

Lint rerun 61774 passed. Full suite 52451 finished with 20,267 passes, 37 skips
and two failures (419.06 s). Both failures were explicit expected built-in lists
in regex/compile-policy and math-f16round.independent missing the newly added Intl
namespace. Added its two method records and tag to those expectations, preserving
the historical fixture bytes, exact hashes, alias/graph checks and host effects.
No runtime code changed after the full run. Focused correction gate 26833 passed
72 tests (one existing skip) across both affected files and all Intl tests.
Following selective-check guidance, do not represent this as a fresh all-green
full run; the evidence is the completed broad run plus verified expectation-only
corrections. Downstream 64813 passed 163 tests in 13 files (26.19 s). Node 18 and
build passed. Final lint of the two changed test files is session 65868.

Grouped-scope scoped release 34210199372 succeeded and published SafeJS 0.1.445
at 09:33:14 UTC. CLI 34210199821 remains active at the last check.
