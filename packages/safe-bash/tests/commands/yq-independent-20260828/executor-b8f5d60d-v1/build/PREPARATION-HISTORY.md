# Static Preparation History

Date: 2026-08-28

This component preparation has invoked no build worker, compiler, product,
serializer, loader, proposed executor, or synthetic execution cohort.

One incidental inline metadata-reading command exited1 while trying to access
`inputs.dataComposition.revision`. INPUTS.json actually names the descriptor
`composition`; the JavaScript error was `TypeError: Cannot read properties of
undefined (reading 'revision')`. The command had printed input descriptors and
had not read that composition or executed candidate code. A later static read
used `inputs.composition` and completed. This is a preparation-reader typo, not
a compiler attempt, product failure, or waived provenance result. The original
exit1 remains recorded here; no previous independent result is rescored.

A later inline static-check command completed its metadata comparisons and three
syntax checks, then exited1 because it incorrectly expected
`git diff --no-index --check /dev/null ASSEMBLY-MAP.json` to return0. Git returned1
for the new-file difference with empty stdout/stderr. The assertion was
`AssertionError [ERR_ASSERTION]: ASSEMBLY-MAP.json: 1 !== 0`; no STATIC-CHECKS.json
was published by that attempt. The corrected whitespace check uses the explicit
owned staged paths with `git diff --cached --check`. This preserves the failed
preparation assertion rather than calling it a worker or compiler attempt.

The three authored JavaScript files received syntax-only checks during drafting.
Final syntax checks and frozen metadata comparisons are recorded separately in
STATIC-CHECKS.json. These checks do not execute imported code or establish the
worker's dynamic behavior. DEFERRED-CONTROLS.json remains entirely UNRUN.

Old35da independent methods/tool identities are reused as references only.
Original409 refusal,90a633e89 preparation failure,4b219 FAIL,CMD22 and deadline
UNRUN remain historical; all postprocessor-failed aggregates remain failed.
No source bug, new pass, compiler reproduction or semantic acceptance follows
from this static source seal. Core's missing observed-tool-provenance envelope
and generated-input/result integration require a separately sealed implementation
before RootGO. This component does not edit or inspect unsealed core bodies.
