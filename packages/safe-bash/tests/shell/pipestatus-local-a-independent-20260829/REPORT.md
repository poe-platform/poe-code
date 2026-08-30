# Independent local -a SOURCE/PURE review: HOLD

Reviewed source commit ec74e14df6bb7caf6b1be59fd44b027d7240101e, evidence
cddf1786440ed284987b375f43315f2163f37db6 and AGENTS revision
64185637eb56ba807d60b06ab893f4430b3ce991 through authenticated Git blobs.
Runtime SHA256:
`d09c19a2f27d66deea9da57ae62cb1d3148db6e434b13dec5b65d5164b1ae670`.

## Controls and supported source conclusions

All **20 author controls replayed successfully**: 17 exact extracted-parser
controls, plus three explicitly SOURCE-only comparisons. Cross-realm results
use explicit own keys/data descriptors/primitive values, not prototype equality
or blanket JSON coercion. Grammar, repeated leading -a, optional --, unsupported
flags and falsy abort identities match the author vectors.

Five independent groups were added: **two pass, three fail** after the N03
reviewer-binding correction below. These execute only the exact isolated setup,
catch or finally control-flow fragments with ordinary doubles, plus SOURCE
checks. Runtime/Shell/BindingStore/ArrayOwner classes are never imported or run.
No whole binding atomicity, actual budget fault, real restoration or actual
private cleanup-fault reachability is claimed.

SOURCE inspection supports the early readonly refusal, repeated late readonly
check before stale-watch refusal, shared ledger owner reservations, admitted
name/text, generation/version/epoch tickets and atomic publication boundary.
Same-frame scalar conversion requests scalarLegacy typed restoration; same-frame
indexed redeclaration copies members; a first indexed local saves its outer
binding. Plain-local suffix and foreign code remain byte-identical. Public API,
ERE, arithmetic and PIPESTATUS publisher were not edited by this delta.

## Blocking findings

1. **N01: fallible setup is outside the new cleanup boundary.**
   `src/shell/runtime.ts:3582` prepares typed saved state; operation creation and
   parent hold acquisition follow at lines 3585/3586, before the try at 3588.
   `src/shell/arrays/ledger.ts:164` and `src/shell/arrays/ledger.ts:205` show real
   finite ledger reservations in create/hold. If either later admission refuses,
   the newly prepared saved owner is not in locals and the branch catch does not
   discard it; a successfully created operation also lacks branch-local closure
   if the hold refuses. Exact setup-fragment probes record prepared=1,
   discarded=0 and operationClosed=0 for both cuts. Parent eventual cleanup may
   reclaim resources; this is a local retirement/accounting gap, not a claim of
   a permanent process-wide leak or an actual product replay.
2. **N02: cleanup can replace the raw primary and skip later cleanup.**
   `src/shell/runtime.ts:3615` awaits shadow release before operation.close in one
   sequential try. A rejecting shadow release skips operation.close; holding
   release still runs. The exact finally fragment replaces primary false, 0 or
   null with the injected secondary error in all three probes.
3. **N03: discard failure can replace the primary.**
   `src/shell/runtime.ts:3613` awaits discardVariable before rethrowing the caught
   reason. The corrected exact catch probe invokes discard once, then observes
   the injected cleanup reason instead of each raw false/0/null primary.

Minimal correction: own all newly acquired resources from the first fallible
setup step under one staged cleanup boundary; attempt every acquired cleanup;
retain the raw first failure separately from secondary cleanup failures. This
does not require additional flags, public API changes, a different parser or
changes to unrelated array algorithms.

## Preserved reviewer correction

The first N03 isolated function omitted the lexical name binding and therefore
raised ReferenceError before reaching discard. Its original failed observation
in `RESULT.json` is preserved and **is not product evidence**. The second PURE
helper supplies name explicitly and reruns only the same N03 group. Exact
corrected observations are in `N03-CORRECTION.json`; `FINAL-RECEIPT.json` uses
that result while keeping the original record/hash. No additional novel group
or full author replay was introduced. N04 readonly/typed-restoration SOURCE
checks and N05 successful-cleanup raw-primary controls pass.

## Source readiness and limits

The author's base hash exactly equals runtime.ts in the existing 323-input
candidate. Non-local feature preservation is supported by that binding and the
three replayed SOURCE comparisons. **SOURCE acceptance is withheld**, so no
composition input origin/hash is updated. `SOURCE-READINESS.json` binds both
versions and leaves the accepted PUBLIC309 README, 115 type files, 40 excluded
extras and prior candidate untouched. R17 is unchanged; original 75 PASS/3 R17
FAIL remains historical. No new coherent build/final freeze is authorized.

This review uses two PURE helpers, at most 24 known OS roles including
publication, conservative peak 3, 24 MiB capture and 128 MiB logical-work caps.
Both helpers capture before child execution; the only helper-owned child is an
authenticated Git DATA batch. Resource snapshots plus a 16 MiB publication
reserve are in the final receipt; Git physical allocation/RSS are not inferred.
No compiler, build, npm, product Shell, Worker, native oracle or author-code edit.
The eight-minute deadline is August 29, 2026, **17:09:16 UTC**.
