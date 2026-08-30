# Generic local -a SOURCE/PURE phase

ROOT authorizes runtime/local-related source only, no compiler/Shell/Worker/native/install. Initial clean runtime is from commit2e6d59787df9d1949d9e342fbd2769cb76240651; all non-local hunks must compare unchanged. Grammar: leading repeated -a, optional --, then NAME or NAME=scalar-value operands; other flags refuse status2 before declaration effects. No declare/typeset/associative/nameref/compound-in-local syntax extension. Plain-local implementation is untouched after option admission.

Generic indexed locals use existing saved-variable retention/restoration, shared ArrayOwner, name admission, watched epoch, final readonly-before-stale, one atomic store publication and ownership retirement. Indexed targets are not restricted to PIPESTATUS. Same-frame redeclaration preserves existing members; scalar initializer updates element0. Initial shadow of an outer binding starts empty unless initialized. Exported/control-variable conversion remains refused.

One source/DATA preparation helper freezes source/fixtures before one PURE execution helper. Twenty groups: fourteen option-parser cases, three exact falsy-abort identities, three SOURCE ordering/provenance controls. Parser controls execute the exact new function body with explicit type-only signature/non-null erasure and a test export; they are NOT full Runtime/binding/cleanup acceptance. All future Shell scripts remain UNRUN.

Proposed next phase: one strict pinned build; unchanged R17 in source/installed/moved, plus plain scalar local/ordinary indexed shadow/nested restoration/redeclaration/initializer/readonly/exported-control refusals/caller-budget-cleanup cases. No original75/3 rescore. Separate independent review needed.
