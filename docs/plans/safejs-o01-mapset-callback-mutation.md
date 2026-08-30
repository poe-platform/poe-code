# O01 Map/Set callback mutation candidate

- Role: delegated implementation worker; independent review and publication belong to others.
- Base: fresh main clone, pulled before work, `af779824231010e84f334337d3416e9658641442`.
- Scope: Map/Set `forEach` structural mutation only. No array callback mutation,
  class support, public iterator redesign, README, skills, or master ledger changes.
- Dispatch manifest SHA-256: `40a2e1939ee1339de8f7a69cb2e93f6ad859fee6fea7905d42f1184eedae5325`.
- Approved recipe manifest SHA-256: `d513b006769864efbabf45adcbdb4a21237a9d4c31e09e1295c5022e16b6d848`.
- Approved oracle-index SHA-256: `939e2b555497f19c21eeb1c73073290a51c0654594887a667b56157e41bf46ff`.
- Missing approved copy: `collections:09-map-foreach-worklist` is absent from the
  approved oracle-index. No logical original path is followed or newly read.

## Implementation sequence

1. Record failing native-oracle tests for append, delete, re-add, clear, live Map
   updates, identity, thisArg, throw cleanup, and nested same-receiver callbacks.
2. Replace frozen callback worklists with owned pending-key state. Notify each
   active traversal on structural changes, consuming keys before callbacks and
   reading Map values at visitation. Never retain a raw host iterator.
3. Charge traversal work and retained pending state; release it on every exit.
   Preserve explicit running-state exclusion and array/generator/snapshot guards.
4. Verify completed replay, failure checkpoints, genuine pending host boundaries,
   callback and host-call counts, and fatal finite budgets for infinite worklists.
5. Run focused and package checks, then freeze exact preimages, patch, hashes,
   evidence, qualifications, and README facts for independent review/integration.

## Oracle and QA

Use strict native JavaScript on the same finite source and compare full returned
graphs. Use fresh replay bindings with host-call counters; replay must not repeat
completed effects. Run only local deterministic tests; no LLMs or unit-test disk
writes. Native infinite callback worklists are not executed. No deadline overrides.
No CLI visual behavior changes are intended; screenshot QA is not applicable.

The normative reference is ECMA-262 keyed collections, Map.prototype.forEach and
Set.prototype.forEach: appended entries are visited, deleted pending entries are
skipped, and reinsertions occupy a new position.

## Implemented candidate

- `map.ts` and `set.ts` now traverse pending keys through the shared
  `methods/collection-callback.ts` helper. Each traversal owns a pending Set;
  mutation notifications update all active cursors. No host iterator survives
  a callback. Map values are fetched at visitation rather than copied up front.
- Pending state is charged through retained data and retained values; initialization,
  advancement, and mutation notifications consume steps. Consumed/deleted keys
  are released immediately, so finite delete/re-add churn has no history growth.
- Legitimate same-receiver nested forEach calls have independent cursors. The
  outermost traversal still holds `enterRunningState`, and explicit running
  exclusion remains effective. Invalid nested callbacks and throws release only
  their own traversal. Array mutation, generator, host callback, and snapshot
  reentry guards remain unchanged. `running-state.ts` itself is untouched.
- No public configuration, environment variables, dependencies, execution marker,
  CLI, SDK signature, eager collection method arrays, or direct for-of changes.

## Validation record

- Initial TDD RED: 23 failures and 13 passes across the new mutation tests and
  the updated obsolete Map-mutation-refusal assertion, before production edits.
- Initial GREEN: all 36 tests passed after implementation. Full graph comparisons
  normalize sandbox object prototypes with structuredClone and represent returned
  Map/Set contents explicitly with guest spread; NaN, undefined, cycles, and
  aliases are not JSON-normalized away.
- Expanded focused suite: 61 passing tests, including failure checkpoints and
  pending host operations. Finite recovery records host effect arguments 0–5
  exactly once. Genuine pending checkpoints contain three running pause calls;
  resume reissues those three only, while completed replay makes zero host calls.
- A separate Node process restores both completed built-runtime Map and Set
  witnesses: native/current/fresh results agree, each original performs three host
  effects, and both current and fresh completed replay perform zero new effects.
- Whole workspace build: all 67 build tasks and root bundle passed. Root production
  typecheck and changed-file ESLint passed. Separate strict test-source typing
  covers the new tests as well; unit tests contain no filesystem writes or LLMs.
- Final SafeJS suite: 216 files passed, one skipped; 8,642 tests passed, 39 skipped.
  Exact commands, hashes, and patch-application checks are recorded in the frozen
  artifact manifest and logs, not as an approval here.
- Additional strict typing of the legacy `running-state.test.ts` reports three
  diagnostics in the unchanged array guard fixture (`readonly never[]` callback
  arguments). The modified Map fixture is typed correctly. The root production
  typecheck, both new test files' strict typing, and all runtime tests pass; this
  extra legacy static-typing qualification is retained rather than widening scope.

## README facts for publisher

Map/Set forEach permits guest structural mutation with native finite visitation:
append is visited, pending deletion is skipped, delete/re-add revisits at the new
insertion position, clear removes pending visits, and existing Map value updates
are visible when reached. Receiver identity, callback arguments, strict thisArg,
throw behavior, and nested same-receiver callbacks are preserved. Callback return
values, including promises, are ignored rather than awaited. Nonterminating
worklists remain subject to configured budgets. Existing eager keys/values/entries
arrays and unrelated guard policies are unchanged. No new options or env vars.

## Handoff qualifications

- Implementation candidate only, not independent review or publication approval.
- The unchanged approved `collections:09-map-foreach-worklist` original cannot be
  executed: its exact copy is absent from the approved oracle-index. New finite
  native-oracle tests are independent witnesses, not substitutes claimed as that
  original. No new read of original audit/archive/security paths was made.
- No original dirty checkout modifications, README/SKILL/master-ledger edits,
  commits, pushes, or releases. Install uses SKIP_SYNC_SKILLS=1 and clone-local npm
  cache; build/test commands unset TERM and do not override deadlines.
- Integrate only the frozen path allowlist against exact preimages. A new helper
  avoids editing the shared running-state source, but map/set and the one existing
  guard test still require conflict-aware integration if main moves.
- All replay evidence is for this source candidate and current execution semantics;
  this is not an old-checkpoint migration or whole-JavaScript conformance claim.
