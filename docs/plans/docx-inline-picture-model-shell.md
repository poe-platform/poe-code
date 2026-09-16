# Inline picture model shell acceptance

Task: `adapt-upstream-tables-bdd` only. Own the new
`packages/safe-bash/tests/commands/docx/inline-picture-model.test.ts`, its literal
registration assertion in `packages/safe-bash/scripts/integration-inputs.test.mjs`,
this plan and `docs/docx/inline-picture-shell-evidence-20260915/`. Root owns product
fixes and Git. No README, later task, push or release edits.

## Original workflow procedure

Use original generated raster bytes and memfs document bytes in an explicit
virtual filesystem. Execute public `docx batch` through the explicit plugin and
actual `.sh` command substitution, binary pipeline/stdin and output redirection.
Admit capability-scoped VFS pictures and base64 bytes, retain numeric EMU sizing,
mutate typed width/height, traverse the inline shape collection, inspect its
owning part and type, and reopen actual binary output through public `Document`.
Run picture traversal must expose a typed Drawing handle and its immutable image
metadata through closed operations. Verify original image bytes through the SDK.
Dry runs emit no binary destination. Invalid negative extent assignments return
the stable usage status and preserve preexisting output/input bytes after earlier
batch insertion. These are four original supplementary shell tests, not source
case passes or renderer fidelity evidence.

## Failing evidence and adapter review

Before registry wiring, all three initial cases failed with unsupported-profile;
the error-specific negative extent assertion prevents generic rejection from
being mistaken for meaningful passing evidence. After wiring, positive cases
still failed with usage. An original direct SDK batch reproduction with canonical
`/work/Coast.PNG` and a matching explicit byte resolver exposed
`Image.from_file` rejecting the declared `kind:vfs` descriptor. This was a concrete
closed CLI adapter defect: primary model factories accept bytes/source/scoped
path, while transport descriptors need explicit bounded conversion. Root fixed
the adapter without broadening the primary model factory. The standalone receipt
preserves the observed exception and boundary decisions.

The initial test used a relative descriptor path; change it to canonical absolute
VFS spelling under the documented model contract before investigating the
remaining product failure. Retain original failing logs and final passing logs.
The literal registration presence assertion failed before its inventory update.

## Maintained verification

```bash
node --import tsx --test packages/safe-bash/tests/commands/docx/inline-picture-model.test.ts
node --test packages/safe-bash/scripts/integration-inputs.test.mjs
npx eslint packages/safe-bash/tests/commands/docx/inline-picture-model.test.ts
npx prettier --check packages/safe-bash/tests/commands/docx/inline-picture-model.test.ts docs/plans/docx-inline-picture-model-shell.md
```

Root runs relevant maintained package/workspace gates before committing. Renderer
QA is not run by this scope; structural images and terminal outputs do not prove
page wrapping, glyphs or pagination. No cloned/downloaded binary fixture is used.

## Terminal QA executed

An explicit disposable TypeScript command instantiated the same actual Shell,
explicit DOCX plugin, original raster generator and memfs document. It executed
a dry JSON picture batch (add, width/height, collection count and type) and an
invalid partially overlapping merge batch. The observed statuses were 0 and 1;
the latter reports ambiguous-selection with affected zero. The command was
deleted after capture. Actual JSON values were only reindented for readable
transcript display; diagnostics and exit statuses remain verbatim.

```bash
npm run screenshot -- cat docs/docx/inline-picture-shell-evidence-20260915/transcript.txt
```

Inspected the resulting screenshot visually: readable typed EMU values, count,
PICTURE enum and failure envelope/diagnostic, with no truncation. Preserve the
copy as `docs/docx/inline-picture-shell-evidence-20260915/terminal.png`. This is
terminal transcript QA, not document renderer QA; Word-page rendering remains
not run.
