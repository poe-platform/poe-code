# PPTX sanitization adapter registration

The maintained integration-input test already requires
`tests/commands/pptx/sanitization.test.ts`, but that file was missing in the current
worktree. The registration guard reproduced the missing-path failure. Preserve
the existing registration and add meaningful original adapter coverage; do not
remove another owner's sanitization work or registration.

Assigned ownership is the new adapter test and this plan only. Root owns staging
and the separate atomic test commit. No product implementation changes are needed.

Two bounded memfs node:test cases invoke the actual virtual shell with the public
command engine. One removes explicitly selected properties, checks public SDK
byte parity, independently confirms the core-property part contains only its
empty root, and compares every unrelated original payload, including package
relationships and content-type declarations.
The other verifies unknown-category exit status 2 before input reads and with
zero binary output. Both retain exact source archive bytes and dispose the shell.

Fixtures are original generated one-slide documents with a literal metadata
value; output expectations are independent part/attribute invariants, not another
engine's generated expected archive. No downloaded fixture, host runtime or
network is used. This is adapter registration coverage, not new upstream-test or
whole-public-API parity. Research remains in the existing sanitization accounting.

The test uses existing committed `sanitizeProperties` and plain `--remove
properties`; it does not depend on new uncommitted sanitizer exports or JSON
category syntax. Committed command metadata and public exports were inspected.

Verification command:
`node --import tsx --test packages/safe-bash/tests/commands/pptx/sanitization.test.ts`.
Root reruns the registration guard and maintained lint; no whole pipeline is run.

Final focused invocation passes both tests; the runner registration check also
passes with 1,110 discovered active TypeScript test files. No existing registration
assertion was removed or changed. Product sanitization remains the pre-existing
properties-only API in this commit; broader uncommitted changes are not staged.

The final guarded repository lint completed 12,285 configured inputs with zero
errors and warnings. Both new adapter suites together passed seven cases.

The initial test incorrectly expected removal of the core-property part. Source
inspection confirmed existing sanitization removes supported scalar elements and
retains their container; the independent expected projection was corrected to
the empty `coreProperties` root without product changes.
