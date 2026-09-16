# DOCX sibling API gate evidence

Investigated on 2026-09-16 at repository revision
`87b944ba372bf145634118d2182db3cf95e1092b`.

Outcome: public byte APIs are present and verified. Required semantic note
construction is not fully supported by the verified public API; DOCX conversion
remains open and no implementation or format capability was added.

## Results

| Check | Observed result |
| --- | --- |
| `npm run build:workspaces -- --workspace=docx` | Passed selected SDK build closure. |
| Public `poe-code/docx` byte consumer | Created, saved to memfs and reopened an original document successfully. |
| Note reference at zero-width scalar position | `usage`: whole resource token required. |
| Note reference selected by nonempty scalar range | Same `usage` rejection. |
| Structured note body supplied as `content` | `usage`: unknown option. |
| Supported whole-paragraph, plain-text note creation | Succeeded; XML inspection showed reference appended after paragraph text. |
| Source bytes after operations | Unchanged in memfs. |
| Existing original model, notes and public export suites | 3 files, 34 tests passed. |
| Converter read/write consumer | Pending; no adapter implemented. |
| Independent Office-open evidence | Pending; not exercised. |

The exact missing capability is a verified public sibling semantic operation for
creating a footnote/endnote reference at an arbitrary inline position and binding
an ordered structured block body. This report does not claim that basic byte
admission or serialization is absent.

Source corroboration:

- `packages/docx/src/operation-types.ts`: `notes.add` accepts `text`, whole-resource
  selectors and kind; no inline offset or structured body. `DocxRunInput` contains
  text/formatting, with no note constructor.
- `packages/docx/src/notes.ts`: note insertion requires a whole body paragraph,
  generates one text paragraph and inserts the reference at the paragraph end.
- `packages/docx/src/document-model.ts`: public document model supports paragraphs,
  tables, sections, pictures and comments; no semantic note construction method.

Low-level public XML views do not establish a verified semantic note construction
API. Building note XML and relationship ownership in the converter would bypass
the requested sibling-engine boundary. The sibling's current operation remains
valid for its documented bounded subset.

## Reproducibility and scope

Executed focused validation:

```sh
npm run build:workspaces -- --workspace=docx
npx vitest run packages/docx/src/document-model.test.ts packages/docx/src/notes.test.ts scripts/docx-exports.test.ts
```

The public probe used Node's assertion API and memfs with `poe-code/docx`; its
original paragraph and note were created in memory. No host document mutations,
external executables, downloaded fixtures or LLMs were used by the probe.
It is structural SDK evidence, not independent OPC conformance or Office-open
qualification. No code changed, so no implementation TDD cycle is claimed.

Raw evidence:

- [Selected build](docx-sdk-gate-build.log)
- [Public memfs probe](docx-sdk-gate-public.log)
- [Focused existing tests](docx-sdk-gate-tests.log)

The [implementation and QA plan](../plans/pandoc-docx-conversion.md) records the
dependency and resumption procedure. The existing task status stays open; unrelated
plan edits and public-wiring evidence are outside this task.
