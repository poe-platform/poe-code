# Bun Closed-Issue Agent-Script Audit

Generated June 11, 2026 from every closed issue returned by GitHub Search for
`oven-sh/bun` through that date. Pull requests were excluded.

## Corpus Integrity

- Closed issues reviewed: **11,742**.
- Issue-number range: **#1–#32134**.
- GitHub query: `repo:oven-sh/bun is:issue is:closed`.
- Collection used 66 non-overlapping monthly creation-date windows. Every window
  remained below GitHub Search's 1,000-result cap.
- The sum of window counts and the number of unique downloaded issue numbers
  both equal **11,742**.
- Corpus SHA-256: `dd071fa92c18fb33626605446b2651459f32bd19502944c1cf06322acf2979f4`.

The audit treated an issue as transferable only when its failure mode is owned
by `packages/safejs`: parsing/evaluation, lexical environments, promises,
generators, sandbox collections, cloning/serialization, or execution budgets.
Bun APIs, Node compatibility modules, package management, bundling, networking,
native crashes, platform support, and process lifecycle were excluded unless a
portable interpreter invariant remained after removing those details.

The complete corpus was screened, then **34** plausible candidates received an
independent issue-specific subagent validation against the issue report and the
current SafeJS implementation/tests.

## Confirmed Active Bugs

| Root cause                                                  | Bun provenance                                                                                                                                              | SafeJS result                                                                                       | Bug report                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| End-of-program microtasks are not drained                   | [#122](https://github.com/oven-sh/bun/issues/122), [#127](https://github.com/oven-sh/bun/issues/127), [#5220](https://github.com/oven-sh/bun/issues/5220)   | `.then()` reactions can be abandoned when a script finishes without another `await`.                | `docs/bugs/safejs-final-microtask-checkpoint.md`  |
| Detached rejections are not owned by the run                | [#953](https://github.com/oven-sh/bun/issues/953), [#970](https://github.com/oven-sh/bun/issues/970), [#14624](https://github.com/oven-sh/bun/issues/14624) | A discarded rejected async call can let `run()` succeed and may leak a host `unhandledRejection`.   | `docs/bugs/safejs-detached-promise-rejections.md` |
| Default execution has no recursion limit                    | [#928](https://github.com/oven-sh/bun/issues/928), [#7899](https://github.com/oven-sh/bun/issues/7899)                                                      | Configured `maxCallDepth` works, but default SDK/CLI execution remains unbounded.                   | `docs/bugs/safejs-default-recursion-budget.md`    |
| Object-literal `__proto__:` has ordinary-property semantics | [#2889](https://github.com/oven-sh/bun/issues/2889)                                                                                                         | Non-computed `__proto__:` becomes an own data property instead of special syntax.                   | `docs/bugs/safejs-object-literal-proto.md`        |
| Large spread operations leak the host argument limit        | [#11734](https://github.com/oven-sh/bun/issues/11734)                                                                                                       | Native spread is used while collecting and applying arguments, causing host-dependent `RangeError`. | `docs/bugs/safejs-large-spread-arguments.md`      |

## Regression-Only Transfers

These issues apply to supported SafeJS semantics, but validators found the
current implementation correct. They are useful provenance for small focused
regressions, not production bug fixes.

| Bun issue                                                                                                    | Transferable invariant                                                           | Suggested coverage                                               |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [#553](https://github.com/oven-sh/bun/issues/553)                                                            | `.throw()` into an unstarted generator must surface the thrown value.            | Generator test before first `.next()`.                           |
| [#2255](https://github.com/oven-sh/bun/issues/2255)                                                          | Thenable assimilation and promise reactions preserve job ordering.               | Promise ordering test using the supported static Promise subset. |
| [#2795](https://github.com/oven-sh/bun/issues/2795)                                                          | Catch-pattern computed keys/defaults use the outer scope, not body declarations. | Catch-destructuring scope regression.                            |
| [#2810](https://github.com/oven-sh/bun/issues/2810)                                                          | Arithmetic inside template interpolation evaluates exactly.                      | `` `${7 * 6}` === "42" ``.                                       |
| [#5719](https://github.com/oven-sh/bun/issues/5719)                                                          | A caught error remains intact across `await`.                                    | Preserve `name`, `message`, and `stack`.                         |
| [#12904](https://github.com/oven-sh/bun/issues/12904)                                                        | Unicode trailing template quasis survive adjacent string concatenation.          | Template + Unicode + `+` regression.                             |
| [#27553](https://github.com/oven-sh/bun/issues/27553)                                                        | `String.raw` preserves a literal NUL code unit.                                  | Construct source with `String.fromCharCode(0)`.                  |
| [#30753](https://github.com/oven-sh/bun/issues/30753), [#31171](https://github.com/oven-sh/bun/issues/31171) | Map/Set preserve distinct numeric keys beyond signed 32-bit range.               | Collection test around `2 ** 31` and millisecond timestamps.     |

## Covered Or Not Applicable

| Bun issue                                             | Disposition       | Reason                                                                                                                |
| ----------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| [#399](https://github.com/oven-sh/bun/issues/399)     | Not applicable    | SafeJS intentionally has no property-descriptor object model or affected globals.                                     |
| [#868](https://github.com/oven-sh/bun/issues/868)     | Not applicable    | Native JSC ownership/double-free defect; JSON serialization is TypeScript and already covered.                        |
| [#3619](https://github.com/oven-sh/bun/issues/3619)   | Covered           | Sandbox `structuredClone` already handles cycles, identity, Map/Set, and budgets.                                     |
| [#5432](https://github.com/oven-sh/bun/issues/5432)   | Not applicable    | Incomplete private crawler/I/O lifecycle report, not a demonstrated Promise combinator defect.                        |
| [#5962](https://github.com/oven-sh/bun/issues/5962)   | Expected behavior | `.then()` must return a Promise; `new Promise` is intentionally unsupported.                                          |
| [#5970](https://github.com/oven-sh/bun/issues/5970)   | Not applicable    | Root cause was Bun streaming `Response` to `Bun.write`, neither exposed by SafeJS.                                    |
| [#6530](https://github.com/oven-sh/bun/issues/6530)   | Not applicable    | JSC proper-tail-call policy; the transferable safety concern is already captured by the default recursion-budget bug. |
| [#8123](https://github.com/oven-sh/bun/issues/8123)   | Not applicable    | Requires `eval` and `var`, both intentionally rejected by the language subset.                                        |
| [#9487](https://github.com/oven-sh/bun/issues/9487)   | Expected behavior | Sparse-array hole destructuring correctly throws; `Array` construction is unsupported.                                |
| [#13004](https://github.com/oven-sh/bun/issues/13004) | Not applicable    | Unreproduced native JSC microtask crash without a triggering program.                                                 |
| [#15056](https://github.com/oven-sh/bun/issues/15056) | Expected behavior | Display escaping was mistaken for JSON-string corruption.                                                             |
| [#22662](https://github.com/oven-sh/bun/issues/22662) | Not applicable    | Native Bun shutdown stack-rendering crash without a reproducer.                                                       |
| [#25004](https://github.com/oven-sh/bun/issues/25004) | Covered           | Callable values are deterministically rejected by `structuredClone`.                                                  |
| [#31501](https://github.com/oven-sh/bun/issues/31501) | Not applicable    | Process-exit policy conflicts with intentional long-running awaits and snapshot/resume; cancellation is supported.    |

## Ambiguous Unsettled-Await Issue

[Bun #22677](https://github.com/oven-sh/bun/issues/22677) can be reproduced in the
supported subset as `await Promise.race([])`. One validator recommended an
automatic liveness diagnostic; another validator for the later duplicate
[#31501](https://github.com/oven-sh/bun/issues/31501) correctly noted that
SafeJS deliberately supports long-running host calls, cancellation, and
snapshot/resume. This audit therefore does **not** file an active bug. Any future
change needs an explicit product policy separating provably internally-dead
promises such as `Promise.race([])` from externally-settleable host promises.

## Conclusion

The complete closed Bun issue corpus yielded five current SafeJS bug
families, eight regression-only opportunities, and no evidence that the other
11,700+ closed issues transfer to the supported interpreter surface.
