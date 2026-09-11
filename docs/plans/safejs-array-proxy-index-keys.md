# Array methods expose numeric keys to Proxy get traps

## Validated failure

Read-only Test262 qualification at revision
`72faf8ec1445c55149615e8b35187830783aba1a` failed `proxy-access-count.js` in
both Array.prototype.flat and flatMap (5b0506). Fresh native Node 22 controls
passed. The initial minimal trace stringified keys and therefore concealed
the mismatch; a subsequent probe retained raw key types (3f0dff).

Guest Proxy get traps receive numeric 0/1/2 instead of string property keys.
Has traps correctly receive strings. The ordinary result arrays can match
native output even while these observable trap arguments are wrong.

The new uncommitted `array-proxy-index-keys.test.ts` reproduced 21 failures
(fe2403): 19 array methods expose numeric get keys, and two nested flattening
cases with string-only traps throw instead of producing the expected array.
The methods include map/filter/reduce/reduceRight, traversal/search methods,
slice, flattening and change-by-copy operations. This is a shared property-read
defect, not just a formatting problem in two upstream assertions.

## Source and next repair

`methods/array.ts` readArrayElement passes its numeric index directly to
`context.getProperty`; interpreter contexts forward that key unchanged.
`guest-proxy-get.ts` passes it into the guest trap unchanged. Native ordinary
property lookup coerces numeric keys invisibly, which masks the error when
there is no Proxy boundary.

Normalize element indices to specified property keys before guest-observable
lookup, and audit other numeric-key call sites rather than weakening the
Proxy assertions. Preserve symbol keys, receiver identity, operation ordering,
snapshot behavior and resource accounting. Re-run the failing upstream cases
and focused array tests after repair.

Runtime sources remain unchanged while full-package session 94973 runs.
The regression file was added after that gate began and is checked separately;
do not assume its failures are part of that gate's discovered tests. It is not
committed without its fix. No repair, push or release is claimed yet.

## Completed upstream selection

The source-level probe used strict mode, YAML metadata, sta/assert and declared
harness includes, with fresh native VM and guest contexts per file. It is not
the official Test262 runner or exhaustive array conformance.

| Array.prototype directory | Guest passes | Guest failures | Exclusions |
| --- | ---: | ---: | ---: |
| toLocaleString | 12 | 0 | 0 |
| flat | 18 | 1 | 0 |
| flatMap | 23 | 1 | 0 |
| reduceRight | 257 | 0 | 3 |

All executed native controls passed. The reduceRight exclusions are
`15.4.4.22-9-b-16.js`, `15.4.4.22-9-b-29.js` and
`15.4.4.22-9-c-ii-4-s.js`, excluded by noStrict metadata. Final process 77342
terminated (07a834); full-package process 94973 remained active (8cb8fa).

## Isolated repair candidate

Two additional native-comparison failures confirm numeric entry keys in
Object.fromEntries and Map construction. All 23 main-checkout regressions
failed before the candidate (b9b780). The defect is shared across internal
numeric-index callers, not confined to the array-method helper.

An isolated source/test copy at `/tmp/safejs-property-key-candidate.XvG8an`
normalizes numeric keys to strings at the beginning of sandboxGetProperty.
Strings and symbols pass through unchanged. This restores the property-key
invariant before the observable Proxy trap and its invariant checks without
requiring each internal numeric-index caller to repeat the normalization.
The main runtime file remains unchanged (ae1d64) during full gate 94973.

Candidate evidence:

- Initial 23 regressions pass (af5230).
- Both original upstream proxy-access-count fixtures pass with fresh native
  controls (6d16ef).
- Broader array/Proxy/Reflect selection: 1,018 tests in 57 files pass (1f98a1).
- Expanded 25-case regression includes pending/completed checkpoint replay and
  passes (d08c70).
- Maintained package TypeScript configuration with exactly one source overlay
  for the candidate runtime: zero diagnostics (e95989).
- Candidate runtime lint with the authoritative file configuration reports
  zero errors/warnings (f815ac); expanded regression lint passes (620e0f).

Transfer the checked candidate after the main integration gate terminates,
then verify the main checkout and commit the runtime, tests and documentation
together. The temporary candidate is not a delivered main-checkout fix.

Four additional inherited-Proxy cases fail in unchanged main (fb7d6f) and pass
in the candidate. They verify numeric-key normalization through prototype
lookup while retaining the original receiver. The candidate's expanded file
now passes all 29 cases (e67d26). The 25 skipped cases in the main baseline
command were intentionally outside its name filter, not newly unsupported tests.
Full-package session 94973 remains active (8d0f24); process inspection also
confirmed its live Vitest PID 24908 consuming CPU (ae6518).

## Entry-constructor qualification

The isolated candidate also passed all 25 top-level Object/fromEntries
fixtures and 28 top-level Map fixtures at the same Test262 revision (79f31f).
Source, metadata and harness handling use the earlier strict in-memory
procedure, with independent native VM contexts and no metadata exclusions.

The original `Map/map.js` fixture fails in this adapter because it calls
`verifyProperty(this, 'Map', ...)`: native script top-level this is the global
object, whereas SafeJS's run entry point uses undefined this. Existing
interpreter tests explicitly cover that entry-point behavior. An independent
guest check of `globalThis.Map` gives the required writable/non-enumerable/
configurable descriptor (295afa). This is not a demonstrated Map descriptor
defect and is not counted as an original fixture pass.

`Map/proto-from-ctor-realm.js` cannot run its native control without `$262` and
remains unqualified. No new Map runtime change is inferred from these two
adapter limitations. Full-package session 94973 was still active (b64662).

## Main-worktree repair

After the full integration run terminated, the unchanged main worktree failed
all 29 regressions (3f169a). Numeric-key normalization was then transferred to
sandboxGetProperty. The broader Proxy, array and Reflect selection passed
1,024 tests in 57 files, including all 29 regressions (49edbe). Targeted ESLint
and the maintained package TypeScript configuration passed (6e098c).

The README now documents the observable string-key behavior. This repair is
local only; no push or release was performed. The preceding full-package run
did not discover this regression file and does not qualify this runtime change.
