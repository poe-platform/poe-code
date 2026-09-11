# Preserve imports referenced by direct eval

## Reproduction

Three runtime-backed tests demonstrate that named and namespace imports are
read successfully through direct eval, but AS-UNUSED-IMPORT offers to delete
them. Session 70356 failed all three cases; four indirect/optional/argumentless
eval and shadowing controls passed. No filesystem fixtures or host eval used.

## Repair

For potentially direct eval calls with arguments, mark visible imports as
potentially read. Do not suppress diagnostics for shadowed imports or indirect
calls. The fixer continues to derive its edits from the same import analysis.
Runtime regression tests require unchanged source and the same result after
autofix; this protects against removal of an actual runtime dependency.

## Validation and delivery

Session 82940 passes all 36 tests across the new import regressions, existing
unused-import rules, eval binding reads and default CLI dynamic execution.
Session 77983 passes all 615 lint/CLI-focused tests across 47 files. Session
35259 passes TypeScript and scoped ESLint. This follow-up exists only
in main; the frozen dynamic-source candidate running as 8302 is unchanged.
Its runtime prerequisite is locally committed as 5541c7a19. Deliver this repair
in a separate atomic local commit. No push or release is authorized.

Readonly Node 18.18 probe 19400 also confirms that autofix preserves the direct
eval import source. Four default-CLI cases (nested dynamic functions, local eval
reads and the separate escape/unescape follow-up) pass in that process. This is
a portability spot check, not a full Node 18 conformance gate.
