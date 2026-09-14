# Explicit XML part access and replacement

Scope: the bounded F07 task only. Later tasks in the existing pipeline remain
pending. Preserve the unrelated working-tree plan changes and historical evidence.
No native reference build, downloaded fixture, product network access, ambient
product filesystem access, README additions, push or release is authorized.

## Contract and implementation

Read root AGENTS.md, the scoped safe-bash AGENTS.md, docs/specs/docx.md,
docs/specs/office-cli.md, docs/specs/office-sdk.md, the public API audit,
reconciliation and parsed upstream-api-inventory.json. The existing grammar uses
`xml get` / `xml set` and operation IDs `xml.get` / `xml.set`; retain those names.

Add async byte-oriented `getDocumentXml` and `replaceDocumentXmlPart` in
packages/docx, backed by the existing namespace parser, package graph, validation
and staged publication. Keep the existing command engine name, add dispatch to
the same SDK functions, and reuse the safe-bash adapter without another editor.
The scoped safe-bash rules require delegated integration work; a worker owns the
new Shell regression file and its exact integration-input registration.

Selection requires one complete absolute OPC name. Raw output is byte-exact.
Default structured data represents original bytes as base64; pretty is UTF-8
display serialization. Keep text/CDATA whitespace, comments and processing
instructions; add indentation only to content without text nodes and outside
xml:space preservation. Never use regex substitution.

Whole-part replacement owns validated input bytes, retains the root expanded
name, existing part content types, document dialect/kind and main-part binding.
Check source protection/signatures before replacement, and candidate invariants
before publication. Unknown content and namespace context must remain unchanged
at their structural positions; unsupported affected edits fail closed. Unrelated
uncompressed member bytes remain identical. XML set has explicit whole-part
intent, including every relationship owner sharing that part; it does not perform
occurrence cloning.

## Language/security mapping and documentation reconciliation

This is a utility-operation milestone, not an implementation of all model XML
views. The research inventory's 920 records and the separate member/protocol/enum
map retain their existing pending dispositions. No underscore-prefixed public
type is hidden or removed; inherited APIs and members without source tests remain
required by later tasks. The existing comment_id/timestamp, table_direction,
collection, UTC date, nullable setter, and unit mappings remain unchanged.

- Python byte strings map to owned Uint8Array. Admission/publication are always
  Promise boundaries; flags are copied before suspension. Raw XML includes BOM
  and original encoding; JSON uses base64 rather than lossy Unicode decoding.
- Expanded XML names and ordered content replace dependency XML runtime views.
  No XPath, eval, regex mutation, dynamic method dispatch, host I/O or external
  relationship dereference is exposed.
- Neutral TypeError/RangeError subclasses report usage; namespace/XML, selection,
  unsupported-edit, validation, budget and publication errors retain stable codes.
- The original snake_case object-model surface remains pending. Utility options
  use shared camelCase names, corresponding to the CLI kebab-case flags.
- Discovery previously reported both XML paths as unimplemented. Update only
  their verified read/edit subset and result shapes, retaining all later operation
  rejection claims. The prior read-only milestones remain historical evidence.

## Failing tests before implementation

1. Added original memfs SDK regressions: 14 failures because the XML functions
   did not exist. Implemented bytes/display and replacement to pass those tests.
2. Added CLI tests: four failures for XML dispatch and discovery, with the existing
   duplicate-selector/stdin preflight already passing. Fixed dispatch using the
   original parser's auxiliary-source descriptors, then passed all five.
3. Added document-kind and inserted-node-limit regressions; both incorrectly
   succeeded before the guards. Added part-type invariants and node accounting.
4. Added a display-option ownership regression; mutating the caller's raw flag
   during admission changed the return shape. Snapshotting the options fixes it.
5. Keep original test names and data; extend exact discovery inventories only by
   the newly implemented XML operations/capability. Shell tests use original
   document text and memfs-backed file mutations, independent of downloads.

## Maintained validation and manual QA

Run the full DOCX workspace test/lint routes, selected DOCX build closure, scoped
safe-bash document command tests and integration-input inventory checks, maintained
source/test compilation and root export tests. Inspect terminal screenshots of
actual XML help, pretty output and replacement/error results. This is a manual
QA procedure; do not add screenshot tests or a QA script. Record final outcomes
below after checks settle. Generated screenshots are disposable and unstaged.

Delivery: one atomic Conventional Commit on main, explicit owned paths only.
Report the local hash separately; no push or release. Later tasks remain pending.

Additional validation-driven corrections:

- XML failure diagnostics exceeded a lowered 16-byte limit. Preserve the parsed
  invocation budget for normal operation dispatch and reuse bounded diagnostics.
- A sink failure after writing package bytes omitted the partial-output warning;
  the XML command now retains that publication warning without mixing text into
  binary stdout.
- Independent Shell review reproduced a long output pathname whose JSON summary
  exceeded its limit only after publication. Preflight the full prospective
  envelope, including destination, hash, bounded byte count and locations, before
  staging any output. The original regression verifies the destination is absent.
- `allowEmpty` was accepted by the grammar but not applied to missing explicit
  parts. Paired CLI/SDK regressions now verify no-change behavior while malformed
  XML still fails. No part is created implicitly.
- Plain XML was unnecessarily converted to base64 and back, causing an exact
  raw-byte limit to fail. Plain/raw CLI requests now use the byte-returning SDK
  path directly; structured JSON retains base64.

Manual QA on 2026-09-14 executed five actual Shell calls: XML get/set help, pretty
XML, replacement dry-run and malformed XML. All produced expected statuses and
outputs. Inspected `/tmp/docx-xml-help-20260914.png` and
`/tmp/docx-xml-output-20260914.png`: options and preservation policy are readable,
XML nesting/whitespace is retained, and replacement/error summaries are distinct.
Captures use the maintained terminal renderer with actual engine output because
this is an injected safe-bash command, not a root poe-code subcommand. This is
terminal QA only; no document rendering or layout fidelity is claimed. Both PNGs
remain disposable and unstaged.

Final maintained results (2026-09-14):

- `npm test --workspace=docx`: **801/801**, 31 test files, no skipped tests.
- `npm run lint --workspace=docx`: ESLint, production and test TypeScript pass.
- `npm run build:workspaces -- --workspace=docx`: the five declared dependency
  closure builds and their maintained lifecycle checks pass.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/xml-parts.test.ts packages/safe-bash/tests/commands/docx/io.test.ts packages/safe-bash/tests/commands/docx-registration.test.ts`:
  **28/28**, no skips; includes all seven new Shell/engine regressions.
- `node --test packages/safe-bash/scripts/integration-inputs.test.mjs`:
  **108/108**, no skips.
- `node packages/safe-bash/scripts/historical-type-models.mjs --noEmit`:
  maintained source/test compilation passes; compile-only, no runtime claim.
- `npx vitest run scripts/docx-exports.test.ts`: **2/2** root export checks.
- Owned staged diff passes `git diff --cached --check`.

All checks above ran against the completed source. Independent review found no
remaining confirmed critical finding after the prepublication result-bound fix.
Only the owned files listed in this commit are staged; unrelated plan edits,
archive moves and disposable QA captures are excluded. Local commit only; no
remote delivery or release was performed.
