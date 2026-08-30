# Independent final CARRY seal review

Status: READY — author-facing normative-precode validation only

Implemented Through: Not applicable

Purpose: Verify the exact committed final overlay against the previously sealed
independent predicates, without creating another product specification.

Date: August 28, 2026.

## Verdict and identity

Candidate **`bd471ef682d768692a682d40009a874f51e3ad68`** is consistent with the
settled root CARRY/guard decision in this bounded review. **No actual remaining
contradiction or policy choice was found.** The author-facing contract/manifest
is ready for Heisenberg's implementation handoff. This is not implementation,
runtime acceptance, product-code GO, or release authorization.

The exact parent is `4b94b827fce7d7efc62a4ce52c5a69c1e4cae46a`. The candidate
changes only the five final-carry packet files and the umbrella README. Its
`git diff --no-ext-diff --binary --full-index <parent> <candidate> -- <six paths>`
SHA-256 is `5c2cca06c7b30d7ef2dd91764ca4b82d615fc68dc58e8cad53d9652baf44f908`.
All three root-supplied artifact hashes and the verbatim decision hash match.
`RESULTS.json#/authentication` records exact modes/blobs/bytes/SHA-256 for the
six candidate files, six prepared files and 28 selected authority/source files.

Predicate seal `c52a1d733576aebad79f154e71146923b5aa4e0c` and preparation seal
`cbc3ff0b8188f8cce88d91382ffc9c149606bcd6` precede candidate reading. Their six
files remain unchanged. The earlier bounded wait is preparation history, not
a finding or current prerequisite. No frozen expectation was adjusted to the
candidate. This informative audit follows the read write-spec skill and its
`references/symphony-style.md`; authority remains the adopted author overlay.

## Mechanism findings

- **CARRY:** Checkpoint-before-next-unit has the selected K formula. A positive
  copy ends with pending in 1..1023; reaching 1023 does not itself require a
  checkpoint. For c=1022/U=1/remaining=1, cost is 1, pending is 1023, and the
  next one-unit reservation costs 2 and refuses with zero remaining. U=0 at
  c=1023 costs zero and preserves pending through empty finish. Neither phase,
  document, unrelated await/engine tick nor close resets that owned state.
- **Arithmetic/admission:** The explicit subtraction-before-addition guards
  cover c+U and U+K, separately handling U=0. The original nine refusal rows
  agree with an independent exact-integer comparator. Separately charged
  estimation determines the reservation's starting c. Q01/C04 gives estimate
  1023, copy 2, combined 1025, not a free estimate or cost-1 copy. The one actual
  Budget.step(U+K) precedes copy allocation and installs credit only on success.
- **Prepaid work:** Copies consume ordinary/checkpoint credit once and use
  direct signal-bound immediates, not another real step/tick. No refunds,
  replacement Budget, query interleaving or nested reservation is introduced.
  Exact finish is synchronous; underrun/overrun and abandon cannot publish.
- **Guards/cleanup:** Both signal and declared closed-admission checks occur
  after awaits, before allocation/copy, and before final publication, including
  a no-checkpoint U=1 and empty close. These checks are uncharged and preserve
  existing identities/selection. Aborted borrowed signal wins over a rejected
  immediate; a live signal preserves its original rejection even when an object
  equals a reason. A failed checkpoint does not justify pending reset. Normal
  admission closure does not invent an execution failure or stop the required
  drain. Prior output effects are not undone; late caller abort before public
  settlement retains priority. The 18 projections are symbolic, not runtime
  cancellation or arbitrary AbortController-state reachability evidence.

The existing implementation is not the future private helper: baseline
`src/commands/structured/limits.ts:53` checks the signal, then increments steps,
then tests the limit; `src/commands/structured/limits.ts:58` performs another
step and conditionally awaits using its private nextYield. The file SHA-256 is
`9919a0c0de44c08a9c63c977f7dc8a6d7319f4111cb37c7f3b249fbfd07743fe` at exact
baseline `5137a74ec855a32d8a8860eb66b62eb44d11e290`, unchanged at accepted length
`74361026502d76b8c2b696f9c60e410ac9b78d95`. A live failed reservation can therefore
increment attempted work without installing local credit; it is not a rollback.
The new helper neither modifies nor promises identical engine yield timing.
Compiler/interpreter-internal synchronous work remains bounded and qualified;
new owned async traversals are not an async wrapper around a synchronous walk.

Exact normative evidence at the candidate:
`tests/commands/yq-independent-20260828/final-carry-v1/CONTRACT.md:123`
(new private async boundary),
`tests/commands/yq-independent-20260828/final-carry-v1/CONTRACT.md:143`
(CARRY),
`tests/commands/yq-independent-20260828/final-carry-v1/CONTRACT.md:175`
(reservation), and
`tests/commands/yq-independent-20260828/final-carry-v1/CONTRACT.md:207`
(guards); file SHA-256
`1e31a9883fdaf3e8fbb890c736a4082246b58d6dafd7479ebbec194dd8531401`.
Private role signatures and rejected-immediate identity qualification bind to
`tests/commands/yq-design-20260828/qb-policy-v1/README.md:42` and
`tests/commands/yq-design-20260828/qb-policy-v1/README.md:263` at
`6620463abdf7e952aaa855abfba13159a6c5cc83`, SHA-256
`96a7ae5aa36cec464a28d9ba09cfcd9791cb0dd09e80a51a6fc203cdd87b7ac6`.
The prior 20 source bindings were also authenticated by the unchanged literal
checker; no product module was imported or executed.

## Crosswalk and inherited boundaries

All **194 original IDs** and every original record/input binding are accounted
for. Exactly eight field overlays are present: NUM-14, NUM-15, UTF-12, ENC-07,
QUE-12, WRK-10, WRK-22 and WRK-26. The four N/encoder input equalities and exact
accepted expectations match; the AST boundary uses the authenticated
reconciliation. WRK-22 selects current timing/guards; WRK-26 updates private-role
vocabulary, not public API. The other 186 records retain their original fields
subject to the explicit global overlay. No current policy-held ID remains.

Fourteen inherited pointer hashes preserve **21 private caps, nine Budget
fields, 54 diagnostics**, help/version bytes (501/37), API/replace-only
registration, information-form admission, CLI, retention and cleanup contracts.
No public YqLimits/DI, new error identity, blanket outer-Shell rejection, or
shared-source refactor appears. Information paths do not create a query Budget.
Default YAML and explicit-JSON-only compact/raw remain inherited.

N acceptance at `914d2c9b61f68adc2adf5e4297f702248c2bd5ef` / independent
`5fa2d5b92c323c1dfcacab1d4998f3d47dfbfc06` is authenticated as 32 expected tuples
and 36 static controls, not broadened into another N review. N5 remains a
reachability observation; ALIAS_CYCLE is not newly reserved. Accepted length
and full846 remain root-relayed acceptance, with no private/package replay.

## Checks, preservation and limits

`check.mjs` SHA-256:
`23211d04290d8ef3f7b669e3a7fcb1459eacabb67909d72ae9f4f98136025f13`.
Run from the repository root:

```sh
node tests/commands/yq-independent-20260828/final-carry-review-v1/results-v1/check.mjs
```

The independent result checker passed. It compared all 64 unchanged QB records:
16 schedules, five sequences, eight chosen admissions, nine invalid/overflow,
four payload and ten original mutation views (**52 arithmetic/control views**),
plus **12 trace-schema views**. It checked **18 guard/four handoff projections**
and detected **all 14 presealed negative families** using in-memory data
mutations. Those are not product-code mutations or new YAML test cases.

Four authenticated top-level checker invocations plus five nested invocations
ran successfully: **seven distinct unchanged historical checkers**, the new
author checker, and the unchanged prepared literal checker (nine invocations,
plus this independent result checker). Exact hashes/statuses/output digests
are in `RESULTS.json`; no author success was merely inherited. The old QB
checker still prints `STATIC_CHECKS_PASS_ROOT_TERMINAL_POLICY_HELD` by design:
that immutable historical output is not a present hold or a failed current run.
The author's 23-row runner was not executed or rescored.

Before/after checks preserve **50 historical files in eight scopes**, all
**59 file/directory membership entries**, Git modes, original blobs and hashes;
the six prepared and six candidate files also match. Added scoped entries and
symlinks are checked, without claiming whole-repository or between-snapshot
transaction protection. The index remained empty throughout execution.
Original 194/80/62 cohorts, old CLOSE columns and earlier pending outputs remain
immutable; none is summed into a unique-product-pass total.

The author disclosed an initial descendant-membership filter defect, not a
product defect. This review independently matches the final inventory to its
earlier baseline. An initial reviewer delta serialization omitted --full-index;
the correct explicit command matches the supplied hash without changing bytes.
There were no semantic check failures or adjustments to frozen predicates.

Product/native/parser execution, runtime cancellation tests, builds/typechecks,
dependencies and private access: **zero**. Actual implementation, configured
filesystem/public API behavior, allocation ordering, asynchronous drain and
runtime cancellation remain future validation work. No performance, security,
full YAML conformance or universal implementation proof is claimed.
