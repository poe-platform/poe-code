# PPTX shared mutation security admission

## Scope and ownership

This atomic improvement owns `packages/pptx/src/masters.ts`, the original
`packages/pptx/src/security-admission.test.ts` cases, and this plan. Root coordinates
the CLI adapter evidence and research receipt. Existing unrelated working changes
remain untouched. No README, network capability, host I/O, native runtime,
downloaded fixture, public export, signature validation or release is introduced.

## Validated defect and implementation

`loadShared` checked relationship types and presentation modification protection,
but admitted disconnected macro/signature parts. Eight original SDK cases first
resolved with mutated presentation bytes instead of rejecting. Three additional
label cases also first resolved with mutated bytes.

Before shared mutations, inspect every admitted part's content type and name.
Reject macro-enabled/VBA content types, digital-signature content types,
`vbaProject.bin` basenames, and the package signature directory. This covers
disconnected signatures, origin records and certificates without pretending to
verify a cryptographic signature. Reads remain inert and available.

Reject the exact normalized classification-label content type, the conventional
`/docMetadata/LabelInfo.xml` name, and custom-property elements whose unqualified
name starts with `MSIP_Label_` in the recognized Transitional or Strict namespace.
Normalize content-type essence before matching, so MIME parameters and casing
cannot bypass admission. Ordinary properties named `label` are preserved.
Custom-property inspection uses explicit cumulative XML byte and node limits.

The shared loader serves properties, masters/layouts/themes/backgrounds, notes,
comments/tags, text/shape/drawing operations, tables, charts, images/media,
transitions/animation, fields, accessibility and equations. Independent guards in
slide assembly/removal/import, membership, presentation settings and XML replacement
remain separate and are not claimed to have complete label or part-name admission.

## Acceptance and QA procedure

1. Run original fast memfs SDK tests through public exports. Confirm rejection for
   disguised macros, recognizable macro names, incomplete signature records,
   labels and protected presentations. Confirm encrypted ZIP flags fail admission.
2. Confirm inert reads, immutable rejected inputs, mutable property-session
   rejection, and independently inspect output ZIP/XML for permitted edits.
3. Exercise corresponding `properties set` CLI operations through the public SDK,
   including forced publication and dry run. Confirm no mutation is published.
4. Run maintained `npm run lint --workspace=pptx`,
   `npm run test --workspace=pptx`, and
   `npm run build:workspaces -- --workspace=pptx`.
5. Root records disposable corpus QA and CLI screenshots separately. No unit test
   downloads input or uses a corpus file. Corpus procedure authority remains
   `docs/pptx/corpus-manifest.json`.

## Evidence and remaining contract work

The initial red run had eight failures and two controls passing. Label expansion
had three failures and eleven passing. The final focused suite has eighteen
passing cases; zero-delay scheduling yields are mocked with immediate scheduling
to keep the original in-memory cases fast. The selected maintained build passed
for its three declared build tasks. Maintained workspace lint passed, including
both production and test TypeScript checks. Maintained workspace tests passed:
173 files, 4,321 tests, 49.20 seconds, including all eighteen security cases.
The CLI owner reported twelve cases passing through the built public SDK.
Root's research receipt records independent CLI proof and corpus QA.

These are supplemental adversarial cases for F55 and shared SDK security mapping,
not claims that unimplemented entries in either upstream inventory are covered.
The audits, inventories and `api-language-mappings.md` were consulted. No source
or assets were copied from a reference project; no additional derived-material
license is needed for this patch.

Complete explicit signature-graph removal and effect reporting remain unimplemented;
this patch offers no partial stripping or signature-validity claim. Arbitrarily
renamed binaries with misleading content types, unknown label formats, and labels
hidden in unsupported extension structures are not claimed detected. No right to
edit follows from any label metadata; recognized labels fail closed. Existing
encryption rejection is retained, not encryption/decryption support.
