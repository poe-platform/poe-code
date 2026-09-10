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
