# Bounded structured document creation

The creation utility accepts original typed paragraphs/runs, headings (title 0,
headings 1–9), rectangular tables and nested cell blocks. Empty documents and
empty or table-ending cells retain required paragraphs. Output is DOCX or DOTX,
Strict or Transitional, with explicit matching package content types and
relationships. No suffix inference, executable templates or external assets.

`createDocumentArchive(options, context)` returns an admitted archive.
`createDocument(options, publication, context)` creates and publishes through the
existing capability-scoped publication engine. Both always return promises.
Options are `kind`, `dialect`, `template` (supplied Uint8Array), `content`,
`timestamp` (explicit UTC string) and `author`. Content implements `DocxContent`;
its optional `page`, `styles` and `theme` implement the exported
`DocxPageSettings`, `DocxStyleSettings` and `DocxThemeSettings` interfaces.
Unknown fields, accessors, functions, cycles, invalid values and unpaired
surrogates reject. Optional undefined is absence; null is accepted only for the
declared tri-state run flags. XML-forbidden characters reject before publication.

The CLI route is `docx create --output PATH`, with `--kind`, `--dialect`,
`--template`, `--content-json` or `--content-file`. JSON/file sources normalize to
the same typed content. File paths and stdin are acquired only through the
injected command context. `--force`, `--dry-run`, `--json`, author/time and limits
retain the shared Office contract. Binary stdout contains package bytes only.
Creation reports one affected document; dry-run has no output receipt.

Defaults and closed settings are authoritative in
[the specification](../specs/docx.md#66-closed-json-input-types). No environment
variables, hidden configuration, wall clock, identity or installed fonts are
consulted. Blank creation has five parts: content types, root relationships,
document relationships, document and original Normal styles. Optional themes
and explicit metadata add only their required parts/relationships. ZIP output
uses sorted names and stored entries; newly authored entries use 1980-01-01.

Template blocks append before terminal section properties, retaining existing
content and untouched payload bytes. Existing styles resolve by exact name and
kind; new styles receive unused IDs. A missing styles part is materialized when
needed. Explicit kind/dialect conflicts, protected/signed templates, and affected
unsupported markup reject. This creation profile preserves template page/theme/
metadata settings and refuses their explicit overrides. Tagged control binding,
repetition, existing content editing and the live document model remain pending.
No public model inventory row is promoted by these utility tests.

Independent assertions reopen original output through a separate ZIP parser,
CRC implementation and namespace-aware XML parser. Memfs publication cases cover
existing-output conflicts, force, alias rejection and output-option ownership.
The original canonical-name reference helper is used for new blank packages;
allocated template style parts are additionally checked by actual relationship
targets and namespace-expanded style references. These are structural checks,
not full OOXML schema certification, rendering or repair-warning checks.
