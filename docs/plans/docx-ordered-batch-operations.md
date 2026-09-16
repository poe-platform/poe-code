# Bounded ordered DOCX utility operations

Task: `ordered-batch-operations` only.
Status: verified complete for this bounded task on 2026-09-15.
Delivery: one owned local Conventional Commit on main; no push or release.

## Authority and scope

Read the root and scoped safe-bash AGENTS.md, docs/specs/docx.md,
docs/specs/office-cli.md, docs/specs/office-sdk.md, the public API audit and pinned
inventory. Keep the original TypeScript utility, package names, assets and tests.
Product logic stays in packages/docx; the existing virtual docx adapter invokes
that package engine and requires no new adapter or root product logic.

This task implements a closed ordered utility array, not arbitrary model dispatch.
The separate existing style/font/paragraph-format/tab/immutable Image executor is
preserved. Mixed utility/model arrays reject without publication. Later pipeline
tasks remain pending. Historical inventories and unrelated plans are unchanged.

## Implemented contract

CLI `docx batch INPUT --ops-json JSON` or `--ops-file PATH` and SDK
`executeDocumentBatch(input, batch, options, context)` share whole-array validation
and the same domain editors. `DocumentBatchInput`, `DocumentBatchOptions` and
result types are public exports. Version is exactly 1. Each typed item has its
existing operation discriminator and closed arguments, plus optional `id`.

An explicit ID begins with an ASCII letter, has at most 64 characters and uses
only ASCII letters/digits/underscore/hyphen. Omitted IDs resolve to step1, step2,
and so on. Both explicit duplicates and collisions with generated IDs reject.
Unknown envelope/item/argument keys, eval, callbacks, accessors, malformed values,
recursive batches and per-item publication/resource controls reject before edits.
Operation count uses the existing bounded batchOperations budget. Syntax for the
entire array is checked before document admission. Explicit CLI stdin consumers
are counted before execution. JSON VFS paths named `-` remain literal paths;
there is no JSON binary-stdin descriptor, preserving the original source contract.

The admitted registry is:

- fields.add/set/list; toc.add/set; captions.add/set
- text.replace/get; lorem.set
- paragraphs.add/set; runs.add/set
- tables.add/get/set; tables.rows.add/remove; tables.columns.add/remove;
  tables.merge/split
- images.add/replace/set/list/get
- properties.set/remove/list/get

Schemas/capabilities/help enumerate this bounded registry. Shared plural resource
names, text replace, common flags/selectors, JSON envelopes and exit statuses are
retained. Utility result schemas describe mutation counts and field insertion/
replacement kinds accurately without changing the preserved style result branch.

## Staging, budgets and preservation

Acquire and decompress the source once. An internal DocumentSession retains the
admitted package and stages owned archive snapshots. Existing domain editors run
against current staged state; they do not serialize or write between operations.
A changed snapshot advances the session generation, and stale selector tokens
reject. Result receipts reflect their operation's generation and retain before/
after generations distinctly.

Session XML parsing reuses admitted member roots by effective limits and full byte
equality, including collision checks. Cache scans and retained entries are charged.
Editing fragments still charge parse nodes independently so insertedNodes remains
accurate. The cache is session-only and shared by lowered budget aliases. Changed
member bytes are parsed as new content; package graph and dialect admission are
rebuilt against staged state. This avoids repeating source decompression while
retaining final validation and truthful cumulative budget accounting.

Work, compressed input, expanded package, XML nodes, inserted nodes, table cells,
matches, retained bytes, batch count and serialized output use shared budgets.
Property reads already charge matches; the executor charges only any unaccounted
result count. Source and intended file identities are acquired only when needed.

After all operations succeed, validate the final staged package and invoke the
original publication path once, including signed-baseline protection and original
conditional VFS guarantees. Aggregate changes use the shared add/set/remove/replace
vocabulary. Dry-run and read-only batches never publish. Any semantic, budget or
final-validation failure discards unpublished state; failed JSON has null data,
zero affected count and operationIndex/operationId when an item failed. Existing
input/output bytes remain intact. Publication failures retain original semantics;
completed or interrupted binary publication is not falsely claimed reversible.

## Exact JS and security mappings

- Batch execution is async and accepts explicit Uint8Array source bytes plus
  capability-bound VFS/binary resolution. No implicit host files, native reference
  build/runtime, product networking, ambient credentials, identity or clock.
- JSON is a declarative closed value graph, not executable Python/JS. No callback,
  eval, arbitrary member path, prototype traversal or host object is dispatched.
- IDs are strings and operation indexes are zero-based safe integers. Numeric
  ordinals and locations retain the existing shared selector contracts; stale
  locations fail after a changed staged generation.
- Images are explicit bounded original bytes/base64 or VFS paths; no URL fetch or
  rasterizer is introduced. Metadata uses existing validated values. Tracked
  text.replace uses explicit author/UTC timestamp; outer and item metadata must
  agree, and absent values never come from the environment.
- Results are snapshots and publication receipts, not live Document/Part/XmlPart
  owners. This utility milestone does not fulfill inherited members, enums,
  collections/iteration, helpers, prose-only APIs or public underscore-prefixed
  types. Their exact audit/inventory dispositions remain pending, not private.
- Documentation drift is corrected only for the admitted utility batch registry
  and runs.set/tracked text.replace utility support. Whole-model claims and pinned
  historical evidence are not promoted by this milestone.

## Original regressions and TDD evidence

Workers and integration ran failing tests before implementation. Small original
memfs tests cover field cache → placeholder replacement → table creation/value/read,
exact raster bytes and properties surviving later text changes, forced output and
input preservation after an invalid last table selector, stable IDs, unknown keys,
eval/callback/accessor rejection before parsing, dual explicit stdin sources,
cumulative inserted nodes/matches/table cells, one acquisition/publication, staged
XML reuse and stale generations. No downloaded/native fixture is required.

Original SVG source-contract coverage caught accidental treating of JSON VFS `-`
as stdin. A new original engine regression failed before the adapter correction
(`/tmp/docx-batch-literal-red.log`) and then passed. Original tests/data were kept.
Schema assertions failed before fixing affected counts and insert/replace kinds.
The SVG fixture modification is type-only to prevent an internal symbol leaking
through inferred exported fixture declarations; original artwork bytes are unchanged.

## Maintained verification and manual visual QA

Final maintained checks passed:

- `npm test --workspace=docx`: 150 files, 3,030 tests passed.
- `npm run lint --workspace=docx`: exit 0, no errors; the unchanged original
  operation-types.test.ts type-only unused-variable warning remains visible.
- `npm run build:workspaces -- --workspace=docx`: selected maintained build
  closure passed (five declared build tasks), including built export smoke checks.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/*.test.ts`:
  all 141 existing adapter tests passed.
- `npx vitest run scripts/docx-exports.test.ts`: both portable/export checks passed.
- Final focused batch/session/admission/discovery review: all 33 tests passed.
- `git diff --check`: passed. No reference identity was introduced in owned product
  source/tests. No native reference build, downloaded fixture or product network
  was used.

These are selected maintained checks, not a claim of a full repository gate or
release. All later tasks remain pending.

Manual QA steps executed by the agent:

1. Run the actual engine's help batch with no document acquisition.
2. Run two sequential original text replacements in dry-run; verify two changes,
   no output publication and exit 0.
3. Append an invalid final table selection; verify no success data and exit 1.
4. Render captured terminal output with the maintained terminal-png renderer and
   visually inspect `/tmp/docx-batch-help.png` and `/tmp/docx-batch-outcomes.png`.

The screenshots show readable help/options, the bounded registry and success/error
output without clipping. Temporary screenshots/logs are disposable QA evidence,
not committed fixtures. The standalone virtual docx command is not a poe-code root
CLI route, so the actual engine capture is used rather than inventing such a route.
