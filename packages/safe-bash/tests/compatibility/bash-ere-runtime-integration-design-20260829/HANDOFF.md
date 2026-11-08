# Shell ERE integration: source-only proposal

Date: 2026-08-29. Status: proposed, not implemented or executed.

## Authority and admission

This plan targets accepted CORE `bf079ada185a79aec864b068f3738ddc5520822e`, a **derived composition, not a Git object**, with runtime source `7196bace8ea2c141d5ed1020fef5bf721c321ace` and ROOT acceptance `76648c57`. The locator is Dirac's `2660137c` handoff, not live HEAD or the later 309-input composition.

`CORE-SOURCE.json.data` is the authenticated 293-input catalog: 230044 bytes, SHA256 `12a5806df9ea13eb66e99bec1f0c0c3198bfeb76da012559d943a4d874070fc4`. Its selected input sizes total 2689324 bytes. This review authenticated the catalog and fetched 20 relevant CORE bodies by their stored blob identities; it did **not** reconstruct or execute all 293 inputs. `CORE-SELECTION.json`, `SELECTED-REQUESTS.json`, and `SELECTED-BINDINGS.json` retain the selection, source identities, and actual fetched hashes. The latter also binds four transport interface/implementation bodies read solely to identify integration seams.

Authoritative policy remains design `a2249d46`, clarification `e2b4823c`, and transport choices `aa16808c`. `DOCS-BINDINGS.json` binds their stored documents and the unchanged 32-reference/8-host-protocol inventories. This proposal does not supersede them.

Transport is bound to `65f0e08078a186d322b7ab975bac5972f09bef17` plus `0f36459ccf38623906c5c80702c5d32111167f4d`, handoff `6c68be44446ad6f3251697f1be6a07910155c53f`, and author authentication `7cdb62ac`. Locke's separate review remains required. R02 checkpoint acceptance `e642c557`/`d922a11d` is not full engine acceptance. R01 capture reporting remains held pending Poincare's independent native-artifact audit.

## Proposed minimal production write-set

Exactly four existing files are proposed initially. This is a future ownership request, **not write authorization**.

| File | Bound existing seam | Proposed change |
| --- | --- | --- |
| `src/shell/parser.ts` | `Word` (line 16), `Lexer` (113), `Parser` (520), `parseShell` (815), `parseShellUnit` (826), `parseShellInputUnit` (836) | Contextual regex-RHS tokenization and retained quote/escape provenance. No global token rule change. |
| `src/shell/conditional.ts` | `ConditionalExpression`, `conditionalBinary` (already includes `=~`), `ConditionalContext.expand`, `evaluateConditional` | A private reached-regex evaluation seam; preserve existing lazy boolean traversal and separate exceptional outcomes from booleans. |
| `src/shell/runtime.ts` | `Runtime`, `Budget`, `State`, `cloneState`, `RuntimeCancellationState`, existing `evaluateConditional` call, `assignVariable`, `prepareVariable`, `prepareArrayObservers`, `indexedEnvironment`, `unsetIndexed` | Fragment-aware operand expansion, private root/session linkage, and owned typed capture publication. Do not emulate indexed arrays with scalar assignment. |
| `src/shell/shell.ts` | Public execution/root lifecycle boundary | Create/retire the private invocation-root association, shared with descendants and drained before public settlement/dispose. No public option or contract field. |

Parser blob `27bcacc6c9a731ff02c6ef3700e96a7a1f8e4ebe`; conditional blob `caab6172df5b8e5bad2d1db007b156f067e295ad`; runtime blob `df6b2c0dfad8d7412f93f434d07a20b2b9375a86`; shell blob `220d6c28a6e50f459a48aaee2030f24a841f4ab7`. Exact SHA256/size bindings are in `SELECTED-BINDINGS.json`.

No proposed edits to public `CommandContext`, `RegexExecutionOptions`, command regex descriptors/replies, engine/transport's seven files, root exports, or array internals. Existing array APIs below appear sufficient. If implementation demonstrates missing atomicity or ownership, stop and propose that specific additional path rather than expanding scope silently.

## Parser and expansion sequence

1. Recognize RHS mode only after a syntactically recognized `=~` in `[[ ... ]]`. Retain unquoted grouping/alternation and bracket contents as regex material without treating regex parentheses as shell command grouping. Distinguish conditional delimiters and shell structural errors before any effects. Outside this context, existing lexing remains unchanged.
2. Preserve quoted versus unquoted fragments in the parsed operand. Escaping must be contextual: quoting literalizes regex material, while an unquoted variable can supply regex operators. Do not flatten into a glob-escaped string or run an expanded string through the shell parser.
3. Fully parse the conditional structure before evaluation, including skipped branches. Expand operands only when traversal reaches that comparison, in the established order, exactly once. No IFS splitting, pathname expansion, or operator reparse. `ConditionalContext.expand(word, pattern?)` currently returns a string; its pattern boolean is **not** an adequate substitute for regex fragment provenance. Add a separate private seam rather than reinterpreting all existing pattern expansion.
4. Shell parse failure and runtime ERE syntax/refusal are different outcomes. R21 exercises structural failure in a skipped branch; R20 exercises skipped expansion/compilation. Do not guess common stderr, line origin, or status from the fact both involve `(`. Preserve the existing parser's source/unit context and test runtime diagnostics separately.

## Root, request, and retirement ownership

The actual transport API is `new EreTransportRoot(bounds, registerCleanup)`, `root.openSession(registerCleanup)`, `session.execute({ pattern, subject }, signal?)`, `session.close()`, and `root.close()`. Constructor/root-session registration precedes acquisition in the bound source. Integration must use those seams, not instantiate `EreWorkerOwner` directly.

Use a private root association keyed by the established invocation ownership/budget identity, with an explicit owner registered at the public-exec boundary. Do not key by mutable `State`: `cloneState` must isolate variables while descendants still share the invocation ERE ledger. Functions/source/eval retain their existing state behavior; substitutions/subshells/pipeline jobs retain their existing cloned state behavior. Both categories share root accounting. A separate public `exec` receives a separate root.

Open a cleanup-owned session only for reached work. A per-request signal or job/session close is not permission to retire siblings' root. Root close blocks new work and joins registered cooperative retirement. Actual transport guarantees for cancellation while a job is active remain Locke's gate, not a new guarantee inferred here. No opaque promise/borrowed-input preemption is added.

Bind private bounds to the established root's `maxExpansionBytes` and `maxExpansionFields`, not mutable command environment or new public configuration. Preserve cumulative private ledger debits across descendants; retain unproved usage rather than refunding it. Engine-profile/transport-profile exhaustion is exceptional status 3 at the conditional-command boundary, not a boolean inverted by inner `!` or swallowed by inner `&&`/`||`. True global `ShellLimitError` stays a global error. Semantic ERE syntax/unsupported outcomes are status 2; protocol/crash/timeout/retirement failures are not syntax or nonmatch.

## Typed BASH_REMATCH publication

Reuse `requireArrays`/`stateMonitor`, `BindingStore.watch`, `BindingWatch.valid`/`close`, `BindingStore.prepareName`/`tickets`/`publish`, `IndexedBinding.create`/`insert`, `textToken`, and `StateMonitor.prepareTypedPublication`. Their bound bodies are included under `selected/`. These are real existing private APIs, not proposed public contracts.

After operand effects, snapshot the actual visible target and obtain its watch/ownership admissions. A skipped comparison does neither work nor publication. Validate a reply before converting captures or allocating the replacement array. Admit the replacement, name, metadata, overlapping capture payload, mutation tickets, and any required retirement while old snapshots remain live. Do not release the old value early to make the allocation fit.

Recheck cancellation/closed ownership after awaits and immediately before publication. Apply declared caller-first, readonly-before-stale ordering; a stale target is not silently retried. Prepare typed state publication and array storage together, then commit without another asynchronous gap. Failure must leave the old target intact and release only newly owned resources. This is an implementation obligation to verify using the existing APIs, not a claim this task proved a ready-made transaction.

Successful matching publishes all indexes 0..N, including empty string values for nonparticipating captures under the selected reporting profile; never truncate at 32 captures incorrectly by omitting index 0. A valid nonmatch replaces with an empty indexed binding. Invalid/refused ERE preserves the prior binding. Negation changes status, not a completed successful publication. Do not infer hidden native spans or distinguish nonparticipation from an empty participating capture solely from native empty strings.

The GNU 5.3 visible-local-shadow rule remains a source-profile statement, separately qualified from Apple Bash 3.2.57 observations. This task retains the design's GNU source bindings (canonical inventory `75c692f66095ad85848915f50e9357e506ed9664415f48ce6104cafa7269368e`, including `lib/sh/shmatch.c`, `variables.c`, and `arrayfunc.c`); it did not reread/execute GNU source or independently reprove that branch. R24 remains the local-shadow reference requiring its own qualified observation. No switch to an always-global assignment is justified by the manual's broad wording or N01.

## N14 boundary preservation

Keep `RuntimeCancellationState` and the existing invocation cancellation/cleanup selection machinery as the authority. Do not catch everything around regex work and return 1/2/3. Preserve actual caller reason identity (including falsy values), real `ShellLimitError`, real execution rejection, control outcomes, diagnostic-sink rejection, and cleanup failures according to that boundary. A fulfilled nonzero command status is not an execution rejection. Avoid truthiness-based error selection.

Exact-Promise limitations remain: a new wrapper/derived promise is not automatically equivalent to the promise whose outcome provenance N14 recorded. The future implementation must demonstrate provenance through the existing boundary, not recognize arbitrary thenables, invent global async ownership, or claim opaque host work is drained. Diagnostic write/backpressure belongs inside the selected execution outcome, before cooperative cleanup and settlement.

## Finite prioritized verification matrix — all future work

The existing inventory is 32 reference IDs plus 8 host protocols, **not 40 newly executed cases**. Reuse their literal programs/procedures; do not replace them with favorable expected values.

| Priority | Membership | Required observation |
| --- | --- | --- |
| P0 | R01–R18 | Existing grammar/quote/match/capture reference inventory; audit RHS token boundaries and fragment conversion against each frozen program. R01 reporting acceptance remains held. |
| P0 | R19–R21, R32 | Lazy traversal, full structural parse, no effects on skipped work, exactly-once operand arithmetic/expansion. |
| P0 | R22–R23 | Valid-nonmatch clear versus successful-match publication under negation. |
| P0 | R24–R28 | Local visibility, readonly, exported-scalar conversion, snapshot isolation, same-state functions. R26 conversion must obey the declared typed-variable profile, not an invented env export representation. |
| P1 | R29–R31 | Explicit backreference/collation/non-ASCII profile refusals; no disguised full POSIX or UTF-8 byte-span support. |
| P0 | H01–H02 | Preabort/no acquisition and request-abort/owned retirement, exact caller reasons, sibling survival. |
| P0 | H03–H04 | Exact private limit and capture ownership boundaries; old binding survives rejected replacement. Distinguish public cases from internal reduced-bound proof controls. |
| P0 | H05–H06 | Real interleaving readonly/stale, diagnostic-sink falsy rejection, cancellation/control/cleanup precedence through N14. |
| P0 | H07 | Validated reply/loaded origin, package move, malformed/late reply controls; defer transport implementation proof to its reviewer. |
| P0 | H08 | Shared root ledger across function/source/eval/substitution/pipeline/job routes and isolation across independent public exec. |

Add only four focused integration controls if absent from those protocols: outside-`[[ ]]` token invariance; no reparsing of expanded `&&`/parentheses; failed replacement retaining an old cloned-array view; exact-Promise versus derived-promise provenance qualification. Each must be presealed with finite fixtures and a declared expected evidence role before execution. Existing accepted public CORE regressions remain a separate unchanged cohort; no broad test invocation is authorized here.

None of R01–R32 or H01–H08 was executed by this sidecar. Native N01–N12 are a separate observed cohort under independent audit, not substitutes for these 32 references or GNU 5.3 runtime evidence.

## Eight concrete risks and ROOT decisions

1. **Capture reporting:** R01 is unresolved. Await the independent native artifact audit and ROOT choice; no capture-reset patch or replacement oracle follows from this plan.
2. **Contextual token boundaries:** grouping, alternation, brackets, escapes, quoted fragments, and conditional terminators can collide. Parser-first controls precede runtime wiring.
3. **Lost quote provenance/double expansion:** a string/glob escape path cannot implement regex fragments safely. Keep the private expansion seam separate.
4. **Incorrect root lifetime:** per-state/per-command construction resets cumulative accounting; whole-root cancellation on one request kills siblings. ROOT should approve the private root association and four-path ownership before implementation.
5. **Partial typed publication:** scalar conversion or old-value release before admission creates data loss on readonly/stale/quota failures. Demonstrate atomic reuse of existing APIs; otherwise report the smallest missing primitive.
6. **Error laundering:** status 3 must escape inner boolean evaluation; caller/global/sink/control/cleanup identities cannot be collapsed into a match result. Preserve N14's exact-Promise limitations explicitly.
7. **Profile/source versus observation:** GNU 5.3 local shadowing, invalid-expression diagnostic origin, and Apple 3.2 captures are distinct evidence domains. No GNU 5.3 native run exists here; no hidden spans are observed.
8. **Unaccepted transport/engine composition:** checkpoint-only engine acceptance and a source-readable transport API do not establish full readiness. Fresh integration GO requires full engine and transport dispositions plus an exact composed source binding.

Requested next decision: approve or adjust the four-file integration write-set and private root linkage **after** R01/engine/transport gates. No new public API is presently justified. Status remains SOURCE-only preparation, with no runtime or release acceptance.

## Execution and evidence qualification

All new activity was source/data inspection and publication. Helpers used bounded Git blob transport with type/size/hash verification before decoding target bodies; none imported/evaluated them. `raw/`, `LOCATORS.json`, and binding manifests retain the captures. Terminal display truncation did not truncate the saved collector captures or admitted source copies.

One source-display shell returned 1 because its final pattern predicate was false; it started no target/fixture child and performed no source mutation. That display outcome is not a product test failure or a passed runtime check. It is not rescored.

The process ledger for this preparation reaches at most 40 known OS starts including the final publication shell, patch helper, and Git index child; the final shell exec-replaces itself with Git commit rather than spawning another process. Git metadata/helper descendants are included. There were no concurrent workers or active target processes, and no target/toolchain/native/engine/Worker/private/network execution. This is known-start accounting, not an OS-wide process census. Administrative executable replacements are not asserted to be new OS processes.

Configured bounds remain 20 minutes / 40 known starts / peak 3 / 64 MiB capture / 256 MiB work. No timeout/cap renewal or old native authority was used. No full resource benchmark, full-tree reconstruction, runtime test, or compilation was performed. Publication is confined to this independent scope; prior archives and foreign staging are untouched.
