# Bounded TOC and caption structures

## Scope and acceptance

Only the existing typed utility structure task is qualified here: fields.add/set
for PAGE, NUMPAGES, REF, PAGEREF, SEQ and TOC; toc.add/set; captions.add/set;
and referenced bookmark creation/rename through bookmarks.add/set.
Original names, APIs and tests are retained. Product logic remains in
packages/docx; the existing safe-bash adapter and root export wiring are sufficient.
Later tasks, shared-story editing, nested instruction replacement, outer nested
cache replacement, live field owners and field batch execution remain pending.

Creation appends a simple field to an explicitly selected whole paragraph.
Instruction options are separate from cached result text. Explicit update maps
to stored dirty; omitted edit flags preserve their lexical XML, including fldLock.
TOC level/target edits preserve other switches. Static captions emit label/text
without a field. Default sequence collisions reject; an explicit sequence permits
reuse. No field executes, and no page, sequence or TOC cache is recomputed.

Existing original memfs tests qualify both XML dialects, every bounded field kind,
static labels, default/explicit sequence collisions, complex sequence instructions,
spanning-field insertion rejection, nested TOC retention/replacement rejection,
selected instruction edits, and bookmark rename with unchanged REF/PAGEREF caches.
Existing command tests cover direct creation flags, inspection, dry-run JSON,
pure binary stdout, schema/help and rejected inapplicable selectors.

## Validated correction

A new original in-memory regression failed before code changes with
`Ambiguous TOC level switches.` A quoted TOC style operand containing an escaped
quote and literal backslash-o was incorrectly split into extra tokens. The
instruction tokenizer now consumes escaped quotes inside a quoted operand,
matching the existing field parser. The test independently asserts the complete
edited instruction, preserved cached content and lexical dirty/lock attributes.
This fixes typed instruction edits without changing public options or CLI output.

## Exact JavaScript, security and audit mappings

inspectDocumentFields(Uint8Array, options, ArchiveContext) and
editDocumentFields(Uint8Array, typed request, PublicationContext) are always async.
Instruction/result/label/target/sequence values are strings; levels are a closed
integer start/end record bounded to 1–9. Stored dirty and lock inspection values
are booleans. Explicit update sets dirty only, without claiming layout evaluation.
Ordinal CLI selectors are one-based; fingerprinted locations enforce staleness.
CamelCase utility options map to kebab-case direct flags through the shared
engine, with common selectors, JSON envelopes, limits and exit statuses.
Publication uses explicit byte sinks/VFS capabilities. Malformed, controlled,
unsafe or unsupported affected structures reject before publication. No native
reference build, ambient host I/O, product networking, downloaded fixture or
substantially derived implementation material is used.

Read the shared office CLI/SDK contracts, documentation audit and schema-v2
inventory. The 920-row pinned inventory has no field-specific model owner; this
utility qualification neither promotes whole-public-API coverage nor hides
inherited members, public underscore types, enums, helpers, collections or APIs
without historical tests. Neutral model spellings and their recorded language,
security and documentation-error dispositions remain authoritative.

The spec already links this bounded structure record, but its target was absent.
Creating this plan resolves that documentation drift while preserving historical
evidence and the cached-field record. No broader conformance claim is made.

## Maintained verification and delivery

Focused field structure, command, adversarial and bookmark reference suites:
105 tests passed, including the SDK and direct CLI regressions.

- `npm test --workspace=docx`: passed 245 files / 5,135 tests.
- `npm run lint --workspace=docx`: passed ESLint and both TypeScript checks;
  one existing unused-variable warning in operation-types.test.ts, no errors.
- `npm run build:workspaces -- --workspace=docx`: passed the maintained selected
  workspace dependency closure (five builds).

No visual CLI presentation changes are made; direct command tests verify output
contracts and binary purity. Commit only the owned tokenizer, regression and this plan on main.
Do not push or release; later tasks remain pending.
