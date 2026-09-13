# Typed presentation binding domain

Owner: bindings domain; files `packages/pptx/src/template-bindings.ts` and
`packages/pptx/src/template-bindings.test.ts`. Shared command/schema/export changes
belong to the coordinating agent. No adapter or existing domain files are owned.

Implement the bounded F57 text/table/image portion through a single in-memory
preflight and package edit. Do not run the whole pipeline, create native fixtures,
edit README files, or depend on the concurrently developed image replacement work.
Repeated-slide creation remains outside this increment.

## Contract and security mapping

`applyTemplateBindings(input, bindings, context)` accepts discriminated stored JSON
records. Every record requires kind, name, `scope: slides`, positive one-based
slide and explicit `cardinality: one|all`. Text uses `text`, tables use a rectangular
`table` string matrix, and images use `image: { bytes: number[], contentType }`.
Reject extra/missing fields, sparse/accessor arrays, nonplain objects, conversion
objects and expressions. Snapshot admitted data before asynchronous input reads.

Literal `{{name}}` markers in ordinary adjacent text runs define text slots;
whole table/picture shape names define structured slots. Every marker in selected
slides must resolve. Names are brace-free, nonempty Unicode text. Unmatched/single
braces stay literal. Duplicate declarations fail; repeated slots require all.
Empty input records preserve bytes. Inserted values are never rescanned.

Tables keep the existing grid and formatting, with values written into first text
runs and subsequent runs cleared. Merged cells, multiple paragraphs, fields, breaks, equations and cells
without existing runs are explicitly unsupported. Bound table cell contents are
literal and do not establish nested binding obligations. Embedded image slots get
new package bytes and a new local relationship; original resource bytes and
picture geometry remain unchanged. Linked/extended image sources are unsupported.

## Validation and original evidence

Initial original text tests failed because the new module was absent. Corrected
fixture creation to use declared shape inputs. Initial runtime tests exposed an
invalid XML text accessor and were fixed using the already-decoded text segments.
A later original empty media-type regression failed stored-data validation before
its fix. Current independent assertions inspect ZIP entry bytes, exact run markup,
expected Unicode text, table color, picture geometry, and stable typed errors.
All fixture files live in memfs; package bytes are authored locally in TypeScript.

Focused commands: `npx vitest run packages/pptx/src/template-bindings.test.ts`,
`npx eslint packages/pptx/src/template-bindings.ts packages/pptx/src/template-bindings.test.ts`,
and package TypeScript checks. Coordinating agent runs maintained full package
checks and CLI/SDK integration before committing the atomic improvement.

The source audit and public API inventory were consulted. Binding execution is an
original workflow composition, not a compatibility port of an executable template
engine. Exact inherited text/table/picture behavior dispositions and upstream case
identities belong in the separate research receipt maintained by the evidence
owner. No fixture downloads or reference material enter production or unit tests.
