# Template binding stored-field validation

Continue the first open pipeline task, `templates-bindings`, against the existing
implementation. Scope is the required stored-data boundary in specification
6.2.1; later ordered tasks and whole-public-API parity remain open.

## Ownership and change

Owned paths are this plan, `packages/pptx/src/template-bindings.ts`, and
`packages/pptx/src/template-stored-data.test.ts`. Preserve all other workspace
changes; do not stage the already modified pipeline plan. No README changes,
downloaded assets, broad Git teardown, push or release.

Require own fields before reading record values. The outer record requires its
five common fields; the existing discriminator validation requires its payload.
Nested image records require both bytes and content type. Existing descriptor
validation continues to reject own accessors. Inherited data cannot fill missing
JSON fields, and inherited accessors must never execute during rejection.

## TDD and verification

Seven original synchronous regressions cover missing name, kind, scope, slide,
cardinality, image bytes and image content type. Each temporarily installs an
inherited accessor, captures validation, restores the exact prior descriptor in
`finally`, then independently checks the error and zero accessor reads. No files,
network, clocks or reference assets are used.

All seven failed before the implementation change: validation invoked inherited
accessors one to four times before rejecting the records. All seven passed after
the own-field admission check. The focused template SDK/CLI run passed 31 tests
across three files. `npm run lint --workspace=pptx` passed, including source and
test TypeScript checks. Owned ESLint, Prettier and whitespace checks passed.

`npm run test:unit --workspace=pptx` completed with 4,362 passing and three failing
tests across 178 files. All template tests passed. The failures are in separately
uncommitted sanitization tests: `sanitize.test.ts` expects ZIP version 10 where
the retained stored entry has version 20; `command-sanitization.test.ts` expects
a noncanonical property part path and a properties classification where the
current report retains it as unknown. These files were untracked at task entry
and are not changed or staged here. The package-wide gate remains failing; this
receipt claims only the verified focused improvement, not pipeline completion.

The input inventories and existing research evidence were reviewed. Exact ledger
reference verification accounts for all 2,700 unit parameter variants and 973
expanded BDD examples with no duplicate or missing inventory references. That
check establishes accounting only, not implementation or semantic parity. The
existing template evidence identifies no direct binding cases in that baseline;
these seven new security assertions do not relabel deferred component or public
API rows. Required standalone notices remain unchanged.

No CLI text, schema or layout changed; existing template command tests exercise
the shared validator. No new screenshot or corpus-rendering claim is made.
