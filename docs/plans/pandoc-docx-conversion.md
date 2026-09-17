# DOCX conversion dependency gate

Status: open; conversion not implemented. This task does not change the sibling
editor, format advertising, the text core or preservation editing.

Revalidated at `4f60fccf2acbb52d15aff2fd6f22dd4536e524d9` on 2026-09-16:
the maintained sibling build and public byte consumer passed, but both footnote
and endnote inline-range insertion and structured-body creation remain rejected.
The current [gate evidence](../pandoc/docx-sdk-gate.md#current-public-api-recheck)
records the exact missing semantic operation. Resume at step 1 only when that
sibling API is available; conversion and Office-open qualification remain open.

## Verified prerequisite and remaining gap

The public `poe-code/docx` entry exports working asynchronous
`Document(Uint8Array, context)`, `Document(undefined, context)` and
`DocumentView.save(sink)` APIs. Byte admission/creation/serialization is present;
do not report those APIs as missing.

The required note mapping has a narrower dependency gap: no verified public
semantic operation creates a footnote/endnote reference at an arbitrary inline
position with a structured block body. `editDocumentNotes` with `notes.add`
accepts plain `text`, selects a whole body paragraph and appends its reference.
Scalar-range selections and a `content` block body reject. A conversion of
`Before` + Note + `after` must retain that order and the note's blocks.

Do not implement note XML, note IDs, part allocation or relationships in the
converter to bypass this gap. Raw XML/package APIs exist, but using them to
construct this feature would transfer semantic writer responsibility to Pandoc.
Recheck sibling support before implementation. Neither a blanket missing-byte-API
claim nor a complete SDK conformance claim follows from this finding.

## Resume and implementation procedure

1. Verify a public sibling operation can insert a reference between runs, including
   a cell paragraph, and create/read ordered note paragraphs, formatted runs,
   hyperlinks, tables and admitted images with sibling-owned relationships.
   Reduce the inline-position example to a failing original memfs unit test before
   changing implementation code. Sibling fixes are outside this task.
2. Write failing original converter tests in `packages/pandoc`, then map SDK
   paragraphs/runs, heading styles, numbering, hyperlinks, table grid ownership,
   notes and supported images to/from the AST. Use public sibling APIs exclusively
   for document admission and construction. Conversion creates a new document.
3. Define a reference-document/style subset from verified APIs. Reject or diagnose
   tracked changes, fields, math, floating drawings and unsupported stories;
   never flatten or omit them silently. Verify CLI/SDK option parity through the
   existing thin safe-bash adapter.
4. Use original in-memory scenarios covering the upstream Readers.Docx and
   Writers.Docx families. Independently inspect OPC relationships, content types,
   styles, numbering, merged cells, missing media and admitted Strict/Transitional
   namespaces. Leave ZIP corruption and limits at sibling codec boundaries.
5. Run maintained workspace lint, test and selected build routes. Obtain actual
   public-consumer conversion evidence and independent Office-open evidence
   before attaching advertised DOCX capabilities. Record unavailable Office
   tooling as pending, never as successful qualification.
6. Commit verified atomic work and this plan explicitly on main. Do not push or
   release without later authorization. Keep the original task open until all
   required conversion and qualification work is complete.

## Gate QA procedure

The gate investigation uses the built public `poe-code/docx` import, not private
sibling source imports. Create a document with one paragraph `Before after`,
save to a memfs Volume, reopen the resulting `Uint8Array` and assert its text.
Obtain the paragraph token using `openDocumentLocations`.

Call `editDocumentNotes(source, {operation: "notes.add", options}, context)` with
`kind: "footnote"` and `output: "-"`, using a memfs stdout sink. Verify:

- A token with scalar range `{start: 6, end: 6}` rejects with `usage`.
- A token with scalar range `{start: 0, end: 6}` rejects with `usage`.
- `paragraph: 1` plus structured `content` containing a bold run rejects with
  `usage` as an unknown option.
- `paragraph: 1, text: "Appended note"` succeeds; public archive/XML inspection
  shows the reference is the final paragraph child and note inspection returns
  that text. Source memfs bytes remain unchanged.

This is a dependency probe, not a new canonical unit suite or an independent
Office-open test. Evidence resides in [the gate report](../pandoc/docx-sdk-gate.md).
