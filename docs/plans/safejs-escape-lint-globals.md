# Legacy escape functions in the lint global declarations

The runtime-global audit (29343) found escape and unescape missing from the lint
declarations. Session 81829 proves both runtime results before failing their
AS003 lint checks; shadow-warning cases also fail, while two misspelled-name
controls pass (four red, two green). This is a lint parity repair, not a new
runtime capability or a recommendation to use these legacy functions.

Add both names to the existing maintained global declaration. Keep dynamic
Function/eval and experimental weak-collection changes in their own delivery
scope. Session 64196 passes all 49 focused tests across four files and scoped
ESLint. Committed HEAD already implements both globals in globals/uri.ts; this
repair adds no runtime capability. Do not modify the
isolated candidate while full unit session 8302 is running.

Node 18.18 readonly default-CLI checks pass for both legacy escape functions
(19400), including exact Unicode escaping and unescaping results.

The subsequent main lint/CLI selection passes all 621 tests across 48 files
(43913), including both escape names and the separate eval-import follow-up.
