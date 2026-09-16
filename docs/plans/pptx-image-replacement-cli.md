# Image replacement CLI delivery

Ownership: command-engine.ts, images-schema.ts, command-images-replace.test.ts,
safe-bash image-replacement.test.ts and its exact integration registration; usage
draft in docs/pptx/image-replacement-usage.md. Domain replacement and provenance
are coordinated by the root owner.

The existing command rejected images replace as unsupported. Original memfs tests
first reproduced that failure for ordinary replacement, shared replacement and
dry-run/cancellation. Implement plural command routing through the domain SDK;
report affected occurrences, protect explicit image inputs from publication,
and expose preservation policies in help/schema.

Checks: focused image command tests, package maintained lint/tests, actual
safe-bash script invocation with memfs and original image bytes. Test cancellation
before publication and retain both presentation/image input bytes. Root coordinates
remaining package/domain gates and commits; this owner does not push.

Ad hoc visual QA procedure: run the maintained screenshot command for the command
help if the root CLI exposes this nested utility; otherwise capture the injected
safe-bash pptx help through the maintained generic screenshot command. Inspect the
PNG for readable wrapping and complete selector/output/preservation guidance.
Disposable corpus QA follows docs/pptx/corpus-manifest.json; no downloaded assets
enter tests or commits. Small original cases are sufficient for command routing;
cross-owner sharing and package relationship fidelity remain domain QA responsibilities.

Verification receipt: original command regression suite has 10 passing cases;
actual safe-bash memfs test passes script publication, image-input protection,
and cancellation during destination admission after the replacement computation.
The latter retains a preexisting destination and the original input. The exact
integration registration guard passed all 107 tests. Selector/schema review found
and fixed missing slide/shared preconditions with a failing original case first.
The root owner coordinates final package gates.

Help visual QA used `npm run screenshot` with the explicit command engine because
the utility is injected into safe-bash rather than registered as a root poe-code
subcommand. The disposable PNG is `.cache/pptx-image-replacement-help.png`; it must
not be staged. No product I/O or fixture downloads were added for this check.

Final root verification: package tests passed 3,140/110, package lint/build passed.
The error screenshot `.cache/pptx-image-replacement-error.png` was inspected:
shared scope without explicit shared intent returns a concise invalid-value error
and status 2 before reads. The required root guarded lint stopped at the fixed
12,000-subject cap, exit 2, zero reported errors/warnings. Root retained guard
limits and left all changes uncommitted under the task's check prerequisite.
