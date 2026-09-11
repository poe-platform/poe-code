# Iterator wrapper structured-clone boundary

Native Node rejects Iterator.from wrappers with DataCloneError. Current SafeJS
main a6ec61d18 instead cloned them into ordinary data. Three regression tests
reproduced this for a direct wrapper, a nested object and a Map value: three
failures, 26 passes in 1.93 seconds.

Reject the existing private wrapper brand in cloneStructuredGraph, alongside
the lazy-helper brand. Do not change portable guest snapshot support, which
preserves private state and remains the correct replay mechanism.

Validate the iterator/from/helper and structured-clone suites plus maintained
type/lint checks. This one-line boundary correction has no visual CLI impact.
Deliver as its own conventional commit and direct main push, independently of
the preceding helper feature release.

Validation: 177 tests across nine affected iterator/clone files passed in 3.95
seconds. Changed-file ESLint, root npm run lint:types, package tsc --noEmit and
git diff --check all passed. No full-suite exclusion or timeout changed.
