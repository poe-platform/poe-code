# Array factories returning Proxies

## Reproduction and fix

A constructor returning a Proxy over an empty object receives native
`defineProperty` calls for indices 0, 1, then length during `Array.from`.
SafeJS instead defined the indices on its internal Proxy wrapper: the trap saw
only length, and reading the result's elements returned undefined. Independent
regressions reproduced the same defect in `Array.fromAsync` and `Array.of`.
All eight new cases failed before the runtime change.

Dispatch result element definitions through the existing Proxy-aware property
operation. Preserve the fast ordinary-result path, as array species writes do.
An initial general-descriptor implementation regressed two existing data-size
controls by retaining descriptor bookkeeping on ordinary arrays; the Proxy-only
dispatch avoids that unrelated representation change. No budget limit is raised.

The regression cases cover descriptor flags, element visibility, refusal of the
second write, no subsequent writes, iterator closing, original-error precedence,
and JSON snapshot replay of successful Proxy results.

The [Array factory algorithms](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.fromasync)
require property creation through the result's internal define operation and
iterator cleanup when creation fails. Native execution is a control, not the
normative authority.

## Native control limitation

The combined throwing definition/throwing synchronous iterator return case
causes native `Array.fromAsync` to consume CPU without completing in the tested
Node 22.23.2 and 26.8.1 processes. A separate native-only Node 26 probe reproduces
the behavior. Those processes were explicitly terminated; no success is claimed.
The corresponding guest test completes and retains the original definition
error. Only this native async comparison is omitted; the guest test remains,
alongside the synchronous native `Array.from` control. Other async native controls
run where the method is available.

A bounded Node 26 control makes return throw twice, then succeed. It reports
`define, close, close, close, close failed`: native cleanup repeats and replaces
the original definition error. This confirms the problematic cleanup behavior
without relying only on elapsed time from the terminated runs.

The first red-test attempt also used an unbounded source iterator, which was
replaced with a one-value iterator before collecting the eight-failure result.

## Upstream probe boundaries

A strict source-level probe of Test262 `test/built-ins/Array/from`, pinned at
`72faf8ec1445c55149615e8b35187830783aba1a`, passed 42 cases before this fix.
Two noStrict files were excluded. `proto-from-ctor-realm.js` needs the unavailable
`$262` realm harness. `elements-deleted-after.js` and `source-array-boundary.js`
assume script-global `this` and var bindings; the function-body SafeJS adapter
does not implement that harness environment. Their failures do not establish
an Array.from defect, and they are not counted as passes. Script/global execution
semantics remain unqualified by this probe.

## Delivery

Focused factory, constructor-order, Proxy-definition/species and snapshot suites:
196 tests pass across seven files on Node 22.23.2. The eight new regression cases
also pass on Node 26.8.1, including its available native async controls except
the explicitly excluded double-throw comparison. These are not full-suite results.
Scoped ESLint, package TypeScript no-emit checking and `git diff --check` pass.

Local only; release hold remains active. No CLI visual output changes.
