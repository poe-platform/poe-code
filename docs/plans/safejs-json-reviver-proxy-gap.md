# JSON reviver Proxy traversal gap

## Confirmed current behavior

Six independent in-memory probes use a reviver to replace the second element
of `["seed",null]` while visiting the first. Each compares a fresh native VM
context with a fresh SafeJS run on the current runtime (1e6f53):

| Inserted value / operation | Native events | Guest events |
| --- | --- | --- |
| Proxy array whose defineProperty throws | define | done |
| Proxy object whose deleteProperty throws | a, delete | done |
| Proxy object whose ownKeys throws | keys | done |
| Proxy array whose length getter throws | length | done |
| Revoked Proxy array | TypeError | done |
| Proxy object with enumerable a | a, done | done |

The reviver returns undefined for `a` only in the deletion case. The other
cases return the visited value. Proxy injection occurs only for the seed value,
avoiding recursive mutation in the reproduction. The guest incorrectly skips
the injected Proxy's children and observable operations.

`json-parse.ts` currently selects array traversal with native Array.isArray,
enumerates via ownEnumerableSandboxKeys, and writes/deletes through native
Reflect on the carrier. These operations do not dispatch guest Proxy traps.

## Pinned Test262 evidence

Commit `72faf8ec1445c55149615e8b35187830783aba1a`, strict source-level probes with
declared harness includes, fresh native Node 26.8.1 contexts and fresh guest runs:

| Directory under test/built-ins/JSON | Guest passes | Guest failures | Harness-unqualified |
| --- | ---: | ---: | ---: |
| rawJSON | 10 | 0 | 0 |
| isRawJSON | 6 | 0 | 0 |
| parse | 68 | 9 | 0 |
| stringify | 64 | 0 | 2 |

Parse failures: revived-proxy-revoked.js, revived-proxy.js,
reviver-array-define-prop-err.js, reviver-array-delete-err.js,
reviver-array-length-coerce-err.js, reviver-array-length-get-err.js,
reviver-object-define-prop-err.js, reviver-object-delete-err.js,
reviver-object-own-keys-err.js. All nine pass their native controls.

Stringify's replacer-array-proxy-revoked-realm.js and value-bigint-cross-realm.js
require the unavailable `$262` realm adapter. Neither is counted as a pass.
There were no metadata exclusions. These are not official-runner or exhaustive
conformance results.

## Repair and verification requirements

After the current full-package gate finishes, add failing regression tests for
the six independent cases and repair guest-aware IsArray, length coercion,
enumerable own-string-key enumeration, property creation and deletion.
Preserve JSON reviver semantics: false definition/deletion results are ignored,
but thrown errors propagate. Preserve key snapshots, callback source context,
mutation order, depth limits and budget accounting. Do not replace all ordinary
result storage with descriptor-heavy representations.

Then rerun the nine upstream failures, focused JSON/reviver/Proxy/source-context
tests, and lint/type checks. Keep this gap open until those checks pass.

Runtime source remains unchanged while full-package session 81518 runs. No fix,
remote delivery or release is claimed by this diagnostic record.

## Regression baseline prepared during the gate

The new `json-reviver-proxy-traversal.test.ts` contains 14 failing guest tests,
all with passing fresh native controls (900b68). It adds descriptor errors,
nested Proxies, ignored false definition/deletion results, key snapshots,
symbol exclusion, array-length coercion and absence of source context for
inserted values to the initial reproductions. The cases were added after the
full gate launched and are independently tested, not claimed as part of it.

The current [InternalizeJSONProperty algorithm](https://tc39.es/ecma262/multipage/structured-data.html#sec-internalizejsonproperty)
explicitly ignores false deletion/property-creation results while propagating
abrupt completions. It uses IsArray, LengthOfArrayLike and EnumerableOwnProperties
before recursively applying the reviver. This confirms the repair's required
operation ordering and error handling.

Runtime code has not yet been changed. Keep these tests with the eventual fix;
the failed baseline is not a completed repair.

## Related inserted-object property writes

A read-only native-controlled probe confirms that Map, Set, Promise and generator
objects inserted by a reviver expose their enumerable property `a` to the
callback, but the callback's replacement is written onto the internal wrapper
rather than the object's guest property table (a5d735). RegExp, Date, boxed Number
and ordinary-function controls update the property correctly.

The separate `json-reviver-inserted-object.test.ts` qualifies replacement and
deletion for all eight categories, plus object-valued replacements into number
and BigInt typed arrays. It reports 10 guest failures and eight passes (0318ad),
with passing native controls. The two typed-array failures bypass guest primitive
conversion and throw TypeError. These tests, too, were added after the full gate
started and remain uncommitted pending repair.

The repair must use the established guest property-table routing for ordinary
inserted objects and the typed-array-aware definition path where appropriate.
Fixing only Proxy dispatch would leave these independently validated defects.

## Isolated candidate while the main gate runs

Candidate root: `/tmp/safejs-json-candidate.xY0dQK`. It contains copies of the
SafeJS src/test trees and package manifest, with shared dependencies and root
test services linked back to the checkout. Only its copied `json-parse.ts` is
modified. The authoritative runtime remains unchanged.

The candidate uses guest-aware array identification, length reads/coercion,
own keys/descriptors, deletion and property creation. Ordinary inserted objects
write through their existing guest property tables. Proxy and typed-array
definitions use the established non-throwing-on-false definition path.

Validation against the copied runtime:

- All 32 new regression/control cases pass (a2f19e).
- The broader JSON plus CLI-help selection passes 265 tests across 14 files
  (d18546), using the maintained root Vitest configuration with the candidate
  root override.
- All nine previously failing pinned Test262 parse cases pass (980cee), with
  fresh native Node 26.8.1 controls.

The initial candidate test invocation could not resolve the root test setup's
service import and ran no tests. Linking the root service source resolved that
setup problem; only subsequent successful runs count as evidence.

After full-package session 81518 is terminal, inspect its JSON report, transfer
the candidate diff with apply_patch, and rerun focused tests and static checks
in the authoritative checkout before committing. Candidate success is not a
main-checkout repair or delivery claim.

Further isolated checks cover pending and completed snapshot replay with an
inserted Proxy and an array-length budget of 64 rejecting a reported length of
1024 before any element read. All 17 cases in the expanded Proxy regression file
pass against the candidate (b79c57). The extra tests are copied into the candidate
from the uncommitted main-checkout test file; runtime source remains unchanged
in the main checkout.

The full pinned JSON/parse directory also passes against the candidate:
77 guest cases, 77 fresh native controls, no failures or metadata exclusions
(742f8c). This expands the earlier nine-case repair probe without claiming
full Test262 conformance or changing the main runtime under its active gate.

The candidate also passes a no-emit TypeScript check using the maintained
package tsconfig and an in-memory compiler-host replacement for exactly the
json-parse.ts source file (6071b4: one overlay, zero diagnostics). This keeps
the authoritative file unchanged and will still be followed by the normal
package check after transfer.
Repository-configured ESLint also reports zero errors and warnings for the
candidate text at the authoritative source path and both new test files
(199c6d). No file replacement or runtime mutation was used for that lint check.

## Main-checkout transfer

The prior full-package run completed with 27,619 passes, 14 failures and 48 skips;
its report confirms the two new JSON regression files were not included.
After that process terminated, the candidate runtime diff was applied to the
main checkout. Byte comparison confirms the transferred file matches the
tested candidate. The main JSON/CLI-help selection passes 268 tests across
14 files (e7e095), including the expanded 35 new regression/control cases.
Normal scoped ESLint and package TypeScript no-emit commands pass (031a54),
as does `git diff --check`. The earlier candidate-only/pending notes above
describe the sequence of work, not the current transfer state.
The authoritative main checkout also passes all 77 pinned JSON/parse cases,
with 77 fresh native controls and no failures or metadata exclusions (14332e).
The diagnosed reviver traversal/property-write gap is locally repaired; no
remote delivery or release follows from these local checks.
