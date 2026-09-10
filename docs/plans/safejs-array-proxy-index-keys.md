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
