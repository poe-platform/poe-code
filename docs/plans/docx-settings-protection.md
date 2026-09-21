# Bounded settings and protection qualification

Scope: only the settings-and-protection task. Later tasks remain pending.

## Supported boundaries

Existing `settings.list` / `inspectDocumentSettings(bytes, options, context)`
reads compatibility entries, field-update intent, embedding flags and protection
without creating owners. Unknown settings are opaque and retained. Protection
password/hash/salt attributes are excluded from settings diagnostics.
Theme/font resource inspection retains embedding bindings and obfuscation metadata;
embedded font mutation and installation remain unsupported.

The existing `xml set` / `replaceDocumentXmlPart` settings profile permits only
an explicit valid `updateFields` boolean change while retaining other settings.
The documented live `Settings.odd_and_even_pages_header_footer` boolean setter
and its typed `batch` operation edit only the header policy. Unknown attributes,
child content, text and invalid boolean storage on that affected policy now fail
with `unsupported-edit` before mutation. Failed transactions preserve the model.
No additional setting edit or rights override is introduced.

Document protection remains conservatively preserve-only, including disabled or
unknown enforcement; presence does not grant editing authority. Unchanged locked
controls can survive ordinary sibling text edits. Affected controls and baseline
lock removal fail before publication. Force cannot override those boundaries.
Package unsupported edits use exit 1; adapter permission/publication failures
remain distinct I/O errors with exit 3.

## Exact JavaScript/security mappings and documentation drift

| Public behavior | Mapping and evidence |
| --- | --- |
| Settings inventory | Always-async admitted `Uint8Array` utility; immutable JSON snapshots, one-based CLI selectors excluded for global settings; `settings.test.ts` |
| Document.settings | Synchronous live getter; existing owners read without mutation; missing-owner creation is a separate protected transaction; `settings-model.test.ts` |
| Settings.odd_and_even_pages_header_footer | Original neutral spelling retained; boolean getter/setter, no Python truthiness coercion; absent policy reads false; explicit supported stored values use the declared Word boolean profile; setter requires JS boolean |
| Invalid/unsupported affected policy | Neutral `UnsupportedEditError`, stable `unsupported-edit`; synchronous setter throws, async typed batch rejects; snapshots unchanged |
| Settings.element / part and inherited members | Existing bounded live XML/package views and model batch registry; raw edits cannot bypass publication protection; no ambient path or dependency-library authority |
| Password/font/external-resource behavior | No cracking, activation, installation, host font lookup or networking; embedded metadata retained as inert package data |
| Collections/helpers/enums/public underscore-prefixed owners | Historical inventory and later scoped overlays retain all obligations; this task neither excludes nor promotes unrelated members |

The pinned `upstream-api-inventory.json` remains historical research. Its Settings
rows say planned; later live-model milestones supply separate implementation
evidence. The earlier audit's creating-getters-pending wording describes its
utility-era boundary, not the current existing live getter. This record resolves
that drift without changing historical research or claiming whole-API coverage.

## Verification

Four original regression variants failed before the code change, each showing
silent removal of affected unsupported policy data. They now verify both the live
setter and shared CLI-accessible typed batch, with unchanged model snapshots.
Fixtures use original wording and the maintained memfs archive builder.

Existing settings, text-replacement and publication tests qualify Strict and
Transitional inspection, unknown/compatibility/font byte preservation, explicit
field-update edits, ordinary edits around locked controls, rights refusals,
password redaction, schema/capabilities, and adapter permission separation.
No downloaded fixtures or native reference build are used.

Maintained fresh `npm test --workspace=docx -- --no-cache` passed 247 files and
5,157 tests. `npm run lint --workspace=docx` passed ESLint and both TypeScript
checks, with one existing unused-type warning in operation-types.test.ts. The
focused settings/protection/text/publication run passed 119 tests. Final original
regressions also exercised actual CLI JSON failure envelopes with exit 1, null
data, zero affected objects and unchanged memfs input.

The actual human CLI failure was captured using the maintained `npm run
screenshot` renderer and visually inspected: the bounded unsupported-edit message
was readable, with no document text or package bytes in the diagnostic. The
temporary original QA driver and screenshot under workspace `/out` were removed
after inspection. No historical evidence or unrelated output was removed.

This bounded task's implementation/test checks are complete. Delivery is local
only; push and release are outside this task. Later tasks remain pending.
