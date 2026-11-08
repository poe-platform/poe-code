# Root decisions and frozen-case conflict — August 27, 2026

Root accepts prerequisite freeze `98f400c4a33eeb03f825213054f90adc1fd979c4`.
This record is additive. It does not modify any original fixture, seal, artifact,
baseline count, or production source. Runtime implementation remains held pending
root's minimal-mechanism resolution. The original v1 13/26 and corrected v2 14/26
remain historical **pre-integration** results, not implementation scores.

## Resolved decisions

1. Both CommandInvokeOptions and internal ShellInvokeOptions must declare
   `readonly signal?: AbortSignal | undefined`. Explicit undefined must typecheck
   under exactOptionalPropertyTypes and retain omitted/undefined no-resource
   runtime behavior. R01 already exercises the runtime forms. The two additive
   type inputs in `decision-types.json` bind this to T01/T02 without replacing
   the original six type families or their missing-field baseline diagnostics.
2. Live delivery keeps native semantics. Ordinary `abort(undefined)` does not
   deliver raw undefined. R07's custom native-branded own-reason undefined case
   remains **preaborted only**; R05/R17 cover thrown getter/cleanup undefined.
   R08's live object/null/false/0/-0/empty/NaN inputs are unchanged. There is no
   new custom live-undefined requirement.
3. Existing handler-error-to-status/diagnostic mapping must remain. “Captured
   execution rejection” means a rejection actually escaping the existing
   execution path, not an error already converted to a numeric command result.
   A nonzero numeric result is not a rejection. Do not elevate all caught errors.

## Precise conflict: R08's outer expectation

The frozen shared hierarchy at `cohort.mjs:230` registers a **command handler**
named `branch`. It captures `parent.invoke("leaf", ..., { signal: inner.signal })`
and then explicitly rethrows a child rejection at `cohort.mjs:233`.

In R08 only the **inner** controller aborts; the outer controller and original
caller remain live. Therefore:

1. The leaf invoke boundary should reject with the exact inner reason, after
   its registered cleanup. The R08 assertion at `cohort.mjs:262` is consistent.
2. Rethrowing that reason from the live `branch` command handler enters the
   existing `Runtime.executeCommand` catch at `src/shell/runtime.ts:593`.
   With no aborted outer runtime signal and none of these seven reasons being
   Flow, ShellLimitError, ShellSyntaxError or EPIPE, existing policy emits its
   ordinary diagnostic and returns status 1 at `src/shell/runtime.ts:611`.
3. The outer invoke has consequently captured **numeric `{ exitCode: 1 }`**,
   not an escaping rejection. No root/outer invoke origin is aborted. Under
   decision 3 it must not recover a rejection from that numeric result merely
   because a descendant report remembers the same reason.
4. The frozen assertion `thrown(result.outerOutcome, inner)` at
   `cohort.mjs:263` conflicts with that policy. It is still unchanged in the
   sealed fixture and must not be used to demand a product mapping change.

**Proposed amendment, not implemented:** preserve the exact inner rejection,
held cleanup barrier, delivered-reason checks, live parent/caller and public
status 0; require outer `{ exitCode: 1 }` plus the existing mapped diagnostic.
The driver's explicit result remains 0 because it captures the outer outcome
and returns 0. Add a separate direct-invoker rejection assertion only if needed;
do not make an ordinary handler rethrow silently bypass shell error mapping.
The same seven R08 reason inputs stay intact. Root must approve the exact
amendment before any frozen executable assertion changes.

R09/R10 do not have this specific conflict: their outer/root origins are actually
aborted, so ranked local/root settlement can still override numeric outcomes.
R13 uses a genuinely escaping invoke env-getter error. R14 captures the later
sibling's env-getter rejection directly before the branch returns; it also
actually aborts its outer origin. R15/R18 use escaping Budget failures. None is
changed or declared comprehensively validated by this mapping inspection.

## Additive type inputs and verification

`decision-types.json` adds T01-U1 and T02-U1 as **supplemental inputs to existing
families**, not two replacement families or new passing tests. Both require
`{ signal: undefined }`; the internal input also checks cross-interface assignment
and readonly mutation rejection. The original typing baseline remains six
missing-field failures. No compilation or candidate execution is claimed for
these new inputs before the actual declaration change exists.

`verify.mjs` still authenticates the original archive, frozen fixture bytes and
both historical baselines. Root decisions are not permission for this reviewer
to alter contracts, runtime, source error mapping, or the unresolved R08 assertion.
