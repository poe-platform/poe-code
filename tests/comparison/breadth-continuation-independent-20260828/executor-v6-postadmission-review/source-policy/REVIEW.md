# Independent SOURCE/DATA policy review — August 28, 2026

## Recommendation to root

**Approve only the narrow source-level design, with the conditions below;
HOLD implementation authorization and every new real admission pending root
adjudication, resealing, different-agent synthetic review and a fresh grant.**

For these authenticated bytes, a callable, host-owned gate returning exactly
`undefined` to the ordered `module`, `worker_threads` queries is consistent with
the bootstrap's unavailable-feature path. It returns no capability, does not
invoke the native getter, leaves the unused `Mf` null, avoids the `Ks` fallback,
and short-circuits this bootstrap's crypto query. There is no source-level need
to return raw Module, a require function, a worker_threads object or a crypto
object. Keeping the current denial and holding the comparator is also safe.

This is a **declared host-profile change**, not stock-Node equivalence, harmlessness
of every import-time effect, runtime qualification, raw Module/CJS certification,
or a recommendation to bypass the package's public entry. No policy was changed.
If root requires adversarial caller identity rather than the existing trusted
dependency model, **hold**: import-window/order checks alone cannot provide it.

## Authority and authentication

Read applicable repository and parent instructions. This leaf owns only new
files in this `source-policy/` directory. No product, author, previous capture or
other worker file was edited. No instruction archive was opened or extracted.
Existing instruction metadata in config JSON was treated as metadata only.

- All four diagnosis files match immutable commit
  `096c204c38fd7f1b6c096b9cb09e0ea877737fec` byte-for-byte. OBSERVATIONS.json SHA256:
  `9edee03f7b259a951ee49d4cd255f18bbf4ac95066a7e059da1554259620fb8f`.
- The admission manifest and handoff match immutable
  `becd1647a1572995750585b5c60d2be7d5fb77d4`. Manifest SHA256:
  `168e7422b0d969ddb8e5e7e7db3003abfdce0497e41217918c293c24ac22fcca`.
- That manifest's member metadata authenticates existing child-003.json
  (`c7b52b2a586a1b8baa7d3a8d4a3c9b14f065563d7f59a553cae555ec7d966c12`)
  and child-003.receipt.json
  (`78bbe43ff593aebc98e603b69c14ac0fc51e330a1863d95761aa90285a1d0dd6`).
  The archive itself was not read; no archive-wide integrity claim is made here.
- All 21 unique actual nextLoad records agree directly with config and source
  path/bytes/hash. The 21 existing materialized sources match diagnosis and config
  size/mode/SHA256, with no source-path symlink accepted. All 21 parse as JS data.
  Final before/after SHA256 checks cover these 21 plus 15 authority/guard files.
  This is not a whole-tree, append-proof, race-free or deferred-chunk audit.
- Existing TypeScript 5.9.3 was used as a parser/binder, not as an engine.
  Tool hash/version are in CHECK-RESULTS.json; local Node reported v22.22.2.
  No external documentation claim was adopted from Raman's REFERENCES.json;
  no web, native getBuiltinModule probe or alternate-entry experiment occurred.

The source prefix below is the existing view
`tests/comparison/breadth-continuation-20260828/executor-v6/runs/admission-v6-01/views/baseline-installed/benchmarks/node_modules/just-bash/dist/bundle/`.
Byte intervals are UTF-8, zero-based, end-exclusive; lines are one-based.

| Source | Bytes | SHA256 |
| --- | ---: | --- |
| `index.js` | 510637 | `70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c` |
| `chunks/chunk-NCUTH6QL.js` | 886 | `fae9347ddabceda17cfed0562a36d8dd570134e42a0d631122a6f85d7c6975f0` |
| `chunks/chunk-ZBUZKIPX.js` | 35477 | `d9edb8f7a5e67c1b64a69e9b2614fe786deec2caeda3fec68f377b6e4c93dcc0` |

## Complete bootstrap binding/control-flow findings

`index.js:808`, bytes **[503524,503786)**, is the complete declaration and try/catch:

```js
var Mf=null;try{let e=process.getBuiltinModule,t=typeof e=="function"?e("module"):typeof Ks=="function"?Ks("node:module"):null;Mf=t?.Module??t?.default??null,typeof e=="function"&&e("worker_threads")?.isMainThread===!1&&e("crypto")?.randomUUID?.()}catch{Mf=null}
```

The property identifier `getBuiltinModule` starts at **503554**, not the call
itself. The `process.getBuiltinModule` access starts at 503546; the first actual
call is `e("module")` at **[503594,503605)**. The distinction matters when binding
source evidence to a runtime operation rather than treating a property token as
an executed callstack witness.

- **Mf:** complete main-bundle AST binding resolution finds exactly three
  identifiers: declaration [503528,503530), assignment [503651,503653), catch
  assignment [503778,503780). They resolve to one symbol; the latter two are
  simple assignment LHS nodes. There is no lexical read/export/reference or
  same-spelling shadow binding elsewhere in this main bundle. This is not a
  theorem about arbitrary dynamically generated code or another bundle version.
- **e:** six same-symbol occurrences, declaration, two `typeof` operands, three
  direct calls. Its initializer reads the unshadowed global `process` property's
  value once. All queries invoke the captured local function **without a receiver**;
  they are not method calls on `process`. A compatibility gate must work with
  this detached invocation and must not require `this === process`.
- **t:** three same-symbol occurrences: declaration plus bases of `.Module` and
  `.default`. `t?.Module ?? t?.default ?? null` short-circuits on nullish values,
  not on general falsiness. Non-null return objects could execute getters/proxies;
  returning literal undefined avoids those effects and leaves Mf null.
- **Ks:** three same-symbol occurrences: import, typeof test, direct fallback
  call. The import at `index.js:2` [1263,1311) maps chunk export `a` to Ks.
  The fallback call is [503628,503645). It is selected only when e is not callable,
  not when a callable e returns undefined or throws. Deleting/undefining the
  process property is therefore a different and unsuitable repair.
- Query order in this try is exact: `module`, then `worker_threads`, then
  conditionally `crypto`. Each query has exactly one primitive string argument,
  no spread, computed key, prefix alias or argument coercion in this source.
  `e("worker_threads")` is [503704,503723); the full crypto expression is
  [503744,503771). The `worker_threads` result's optional `.isMainThread` must be
  **strictly false** (`=== !1`) to reach crypto. Undefined/null, true, 0, missing
  property and other non-false values do not enter that branch.
- `e("crypto")` is itself a normal call, not an optional one. Its result has
  optional property access, and `randomUUID?.()` is an optional **method** call
  retaining its crypto-object receiver. Nullish crypto/result method skips the
  call; a non-nullish non-callable method can throw. Its result is discarded.
- Every throw inside this try, including property access/getter, query, fallback
  or UUID-call errors, reaches a catch with no binding, no rethrow and only
  `Mf=null`. A throw skips all remaining statements in the try; it does not roll
  back side effects already performed. Statements after the catch still execute.
  In particular, the old first-query denial prevents the worker/crypto queries;
  it does not imply import rejection. The offline violation remains externally
  recorded even when the comparator catches the thrown error.

For a callable undefined-returning gate: e is captured; the module query consumes
the first slot; t is undefined; Mf becomes null; the worker query consumes the
second slot; optional `.isMainThread` yields undefined; strict comparison is
false; crypto is not queried. This is **source-derived conditional reasoning**,
not a replay of that branch under a new policy.

No stock Node getter behavior was probed. The code-level comparison is conditional:
a host supplying populated module/worker objects permits property reads and,
with isMainThread strictly false, the additional crypto/UUID path. The proposed
undefined returns deliberately remove those observations. That supports a named
unavailable-feature profile, not a claim that stock Node supplies the same values
or has the same capability set, incidental effects or performance.

## Fallback and independent capability paths

Both main and fallback chunk have `createRequire` import [0,40) and local
`require=createRequire(import.meta.url)` [40,85), line 1. These are **outside**
the bootstrap catch. If those import/createRequire operations fail, the catch
does not rescue them. The shim's [267,516), line 2, selects a defined local
require, otherwise a Proxy (if present) or a throwing function; the latter can
recheck require and use `require.apply(this,arguments)` before throwing.
Its export [856,885) explicitly maps local `m` to export `a`. In these exact ESM
bytes successful prelude initialization supplies a callable local require;
the absent-require branches are not activated by returning undefined from e.

**Do not expand “unused Mf” to “the comparator has no Module access.”**
`chunk-ZBUZKIPX.js:2` independently imports `node:module` as `$` at [121,151).
At line 6, [9832,9928), it initializes P/m/A, then conditionally executes
`P=M.AsyncLocalStorage,m=$,A=m.Module??m.default??null` under its own try/catch.
Those are different live bindings, not shadows/references of main-bundle Mf.
Its `protectModuleMethod` [33321,34005) uses A; `protectDynamicImport`
[31404,33151) uses m and can invoke `registerHooks`, wrapping an error with cause
if registration fails. Feature function I [10251,10310) checks callability,
which a throwing offline stub still satisfies. Later activation may therefore
hit a different existing denial; this proposal does not authorize or solve it.

The other two `getBuiltinModule` substrings are **string data**, in the guard
configuration object [1744,1940), line 2: property-name string token at 1750
(substring 1751) and reason string token at 1851 (substring 1860). They are not
two more direct property queries. They are still relevant: `applyPatches`
[20647,21761), `applyPatch` [34005,34772), `createBlockingProxy`
[17688,18222), and `restorePatches` [34772,35452), all line 6, can wrap functions,
retain descriptors and restore them. A captured compatibility wrapper must remain
revoked even if wrapped or restored later. These methods were not executed here.

Also, suppressing this bootstrap's crypto path does **not** suppress all UUID or
randomness in the comparator: the distinct function S at line 6 [9632,9832)
tests global crypto/randomUUID and otherwise constructs a UUID-shaped string
using Math.random. No randomness/determinism equivalence claim follows.

## Existing guard/worker boundaries, and limits

Paths in this table are relative to
`tests/comparison/breadth-continuation-20260828/` and are authenticated at the
admission commit. Exact excerpts and complete hashes are in the JSON evidence.

| File / lines | Byte interval | Relevant source behavior |
| --- | --- | --- |
| `executor-v6/worker.mjs:36–55` | [2352,4325) | Authenticates view, installs loader/offline, awaits consumer import at 44, checks entry/resolution, then uses factory at 51. No temporary query gate exists. |
| `executor-v6/worker.mjs:102–116` | [8095,9010) | Captures resource receipt, restores guards, checks tree and marks exit 1 for any violation/denied load/pending/late error; catch also restores and fails. |
| `executor-v6/loader.mjs:19–36` | [665,1709) | Authenticated consumer scope, exact admitted file map, file type/mode/size/hash checks. |
| `executor-v6/loader.mjs:38–85` | [1714,5314) | Exact worker→consumer and consumer→bare-engine parent/URL checks; actual returned source hash and module/commonjs/json formats. Builtin resolution rejects inspector, inspector/promises and vm, not every capability-bearing builtin. |
| `executor-v3/offline.mjs:29–65` | [1196,3695) | Sticky violation before throw; authenticated asset reads; bound-base createRequire with builtin/admitted-path checks; five named module APIs denied. |
| `executor-v3/offline.mjs:98–117` | [6080,8587) | Listed network/process/worker/Wasm denials, tracked timers/descriptors and restoration; explicitly declares trusted-dependency, non-adversarial scope. |
| `executor-v3/regular-read.mjs:9–24` | [256,998) | O_NOFOLLOW descriptor read, regular-file/size bounds, complete read and finally close. Not a namespace lease or whole-tree race guarantee. |

Worker SHA256 `aa18dd6294fab08bd1f74132f0ca292f0dc0227138cf5956f25ba8c4084e568f`;
loader `0878dfd6ec02b7c232495e44e4e702216586ce0b5e7eb42aad73abb817683a97`;
offline `a0cea0eb858b4d545fa124a1bae063e33ca170a87f91fcedbe6d950422584cd3`;
regular-read `9995afc3c98840ece5b85fa7057c48f5331c5e174b52a8dea682df65c72833bb`.

The checked createRequire wrapper does not copy cache/extensions. That is not
certification of raw Module, `_load`, `_resolveFilename`, `_cache`, `_extensions`,
`prototype.require` or `_compile`: the offline blacklist does not replace those
surfaces, while `node:module` imports already pass the builtin branch. A raw
object returned by the proposed getter would add needless authority; returning
none does not remove existing imported authority. No composed bypass was tried.
Blacklists and `syncBuiltinESMExports` calls do not prove every alias/future API
safe. Asset/loader checks do not automatically certify all alternate CJS routes.

Offline `close()` restores patches; it is not an arbitrary-work drain/preemption
primitive. The actual closed-worker history is retained, but this review does
not independently re-probe PID/process groups or certify all future teardown.

## Required controls BEFORE any new real admission

1. **Explicit authority/profile binding:** root separately approves only this
   unavailable-feature profile for the exact comparator version, source hashes,
   admitted closure, public consumer URL, worker parent, recipe and Node/tool
   profile. No target-side exception; no cache-busted alternate entry, direct
   bundle entry, fallback route, new command, raw Module facade or native getter
   delegation. Retain both source and returned-load authentication.
2. **Finite state, exact values:** unarmed → expect-module → expect-worker →
   exhausted/closed. Validate one primitive string argument and the exact ordered
   values, with no coercion. Return literal undefined, not an object, thenable,
   stub module, function or proxy. Advance state before observable callbacks;
   exhaust the allowance immediately on the second accepted call. Deny repeats,
   order changes, extra arguments, aliases such as `node:module`, worker aliases,
   crypto and every other name. Calls after closure must fail, even via retained
   references. Do not reopen a wrapper for another import.
3. **Window lifetime:** install offline denial first; open only around the single
   authenticated `await import(consumerURL)`. A dedicated `finally` must revoke
   the window on success and rejection **before** checking exports or invoking
   any factory/VFS setup/C11/workflow. A successful import also requires exactly
   two accepted queries and no sticky violation. Rejection/incomplete sequence
   fails admission; a caught unexpected call still fails admission. Immediate
   exhaustion after slot two shrinks the asynchronous import-promise gap.
4. **Revocation is state, not just property restoration:** every captured detached
   wrapper must consult the same permanently closed state. Restore the ordinary
   denying process property after import, not native capability. Descriptor/proxy
   save/restore must never resurrect admission. Keep existing offline/loader guards
   active through factory/setup/workflow and existing supervised teardown. A
   finally that only restores `process.getBuiltinModule` does not revoke e.
5. **Truthful identity boundary:** source authentication plus exact sequence
   constrains trusted code; it does not authenticate the caller of a process-global
   function. The runtime cannot tell a literal `"module"` from an equal constructed
   string, or distinguish another caller issuing the same pair during the window.
   Stack-substring matching is not authority. The source itself aliases the getter
   as e, so “deny aliases” must mean name/entry aliases, not rejecting its required
   detached reference. No parallel/untrusted import work is admissible under this
   assumption; if stronger caller proof is required, hold rather than invent it.
6. **Different-agent synthetic controls, sealed in advance:** ordered two-query
   success with undefined values and zero native delegation; missing/extra/reversed
   queries; node:-prefixed names and other strings; nonstrings/extra args; queries
   before open, after second slot and after import success/rejection; caught denials;
   detached saved function, proxy and descriptor-restoration calls after closure;
   import rejection before/after each slot; factory/setup/workflow boundary attempts;
   asynchronous queued follow-ups; wrong source/hash/parent/entry/target engine;
   observer failure/reentrancy without state reuse. Test ordinary-denial restoration
   and sticky worker failure independently of export/factory completion. These are
   required future controls, **not tests run or permission to run engines now**.
7. **New complete admission authority:** integrate only after independent review;
   reseal recipe/policy, review the separate reporting repair, obtain a fresh root
   grant, and rerun the complete required admission matrix under that authority.
   Do not reuse the consumed grant, excuse the old caught denial, award C11 or
   semantic credit, or silently turn this source finding into full admission.

## Honest check counts and preserved history

Preseal/checker commit `35d39a23`; tooling correction `0be1a18a`; original result
and supplemental preseal `ef136fa8`; supplemental result/final preseal `2c86b9c5`.
ATTEMPTS.md preserves the first checker failure (wrong in-memory shim path, before
AST/after-hash completion). The completed original run is **25/26**, not all-pass:
the independent preseal expected one raw token but found three. The presealed
supplemental classification is **3/3**. The final DATA cross-check confirms **21/21
load-record agreements** and **36/36 previously authenticated file hashes**;
these are different denominators, not 85 runtime tests or a semantic score.
Results are exclusive captures, each below 262144 bytes. The broad supplemental
spelling context is not used as binding/reachability proof; named final excerpts
are each at most 2000 bytes. No full comparator source dump is supplied.

Actual V6 remains `UNSAFE_STOP`, **3/14 workers**, target installed/moved **211
qualified load observations each**, comparator **21 loads**, caught module denial
and **exit 1 despite export/factory completion**. **0 C11 / 0 semantic calls**;
grant `5ac29fef` consumed; recorded workers/coordinator all closed. Stdout remains
**359581 observed / 65536 retained / 294045 irrecoverable**. RESULT remains
**531954 bytes**, with **four other artifacts >262144**. Reporting repair is
another reviewer's scope; this report neither reconstructs lost stdout nor
requalifies those records. All earlier failure/control history and
**W07 UNQUALIFIED/UNCREDITED** remain intact. No full gate, native/service parity,
private/SafeJS integration, duration or comparative-superiority claim follows.
