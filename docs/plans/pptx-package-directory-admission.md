# Package directory namespace admission

## Validated issue

While implementing bounded package tools, four original tests showed that
`readPackage` ignored explicit ZIP directories during canonical namespace
collision checks. A regular file could occupy that directory or its ancestor,
in either archive ordering. This violates safe package member admission.

## Change and ownership

The delegated package-safety worker owns the clean `package-reader.ts` edit and
new `package-directory-collisions.test.ts`; root reviews and commits only these
files and this plan. Explicit directories contribute to the parent namespace,
while valid directory records remain excluded from the part list. Existing file
identity matching and byte ownership are retained. No derived assets or source
material were used; tests use authored in-memory archives.

## Verification procedure

Run the original directory cases plus maintained reader, writer, URI and content
type tests; check package lint/types. Preserve all unrelated work. Commit this
atomic fix locally on main; do not push, release or run the whole pipeline.

## Evidence

Four red collision cases reproduced before the fix. The focused directory, reader,
writer, content-type and URI suite passed 192 tests across five files. Maintained
`npm run lint --workspace=pptx` passed (ESLint plus source/test TypeScript checks).
The selected workspace build closure also passed. The full-package sanitization
failures recorded in the package-tools plan remain outside this atomic change.
