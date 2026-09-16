# PPTX typed template bindings

Scope: one atomic improvement implementing literal text, fixed-grid table and
image occurrence bindings through the package SDK and safe-bash CLI. Repeated
slides remain a proposed F57 obligation. No whole pipeline, push or release.

## Ownership

- Domain agent: original binding types, validation, planning and package tests.
- Root integrator: public exports, runtime schema, adapter integration and checks.
- Evidence agent: this plan, binding evidence/usage, the `template.apply` register
  row and `Bindings` definition, and the bounded specification section.

## Implementation and verification

1. Reproduce missing operation support with original failing SDK and memfs CLI
   cases. Use hand-authored content and independent text/XML/media assertions.
2. Require kind, name, slide-local scope, one-based slide and `one`/`all`
   cardinality. Validate the complete binding set before exposing any mutation.
3. Exercise missing/unknown/duplicate bindings, Unicode, literal braces,
   non-cascading replacement, repeated slots, structured payloads, formatting and
   image occurrence isolation. Verify empty input is byte-identical.
4. Execute the maintained scoped tests, lint and selected workspace build closure.
   Inspect generated CLI help/error screenshots when command output changes.
5. Commit explicitly owned files only after checks pass; report local hash. Do
   not push, release, alter README files or execute the whole pipeline.

## Disposable corpus QA procedure

Use only an already-cached file enumerated by
`docs/pptx/corpus-manifest.json`; verify its SHA-256 before use. Never download a
unit-test dependency. Admit its bytes through explicit context, choose a visible
slide-local run and author a disposable marker in an in-memory copy. Apply a text
binding, reopen it, independently verify the expected literal text and preservation
of untargeted package parts. Check the empty-bindings byte identity on the original.
Do not infer rendered fidelity from structural checks. If meaningful failure is
found, reduce it to a tiny original regression before fixing it. Retain concise
results in the evidence document; never commit corpus bytes or QA output. Delete
only newly created, explicitly owned disposable outputs.

## Research boundary

The pinned inventories have no direct text/table/image template binding API or
scenario. Existing per-parameter text/table/image ledgers remain the accounting
for component behaviors; this feature adds original composition/security cases,
not a claim that the complete model API is implemented. Evidence lists exact
keyword candidates and their dispositions. Required standalone notices remain.
