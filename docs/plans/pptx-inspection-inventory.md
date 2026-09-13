# PPTX inspection inventory

## Scope and ownership

Implement the next bounded inspection milestone, not the whole pipeline. Root owns
`packages/pptx/src` changes and this plan plus inventory research/usage documents.
The delegated adapter worker owns only its new safe-bash inventory test and
`pptx-inventory-adapter.md`; root coordinates the local commit. Existing dirty
files, README files and disposable corpus bytes are not owned by this change.

Authorities: [format specification](../specs/pptx.md), [CLI contract](../specs/office-cli.md),
[SDK contract](../specs/office-sdk.md), root AGENTS.md and scoped safe-bash AGENTS.md.
Consulted [test audit](../pptx/upstream-test-audit.md), complete test inventory,
[API audit](../pptx/upstream-api-audit.md), complete API inventory, J01–J10 mappings,
existing case ledger and [corpus manifest](../pptx/corpus-manifest.json).

## Implementation and acceptance

- Extend the existing async byte SDK index with immutable inspection data; expose
  the same result through CLI JSON and its actual schema/capabilities.
- Preserve ordered slide IDs; inventory layout/master/theme relationship paths,
  unique owner counts, OPC parts, media part hashes and all relationship edges.
- Count drawing objects only in ordered slides, excluding notes/layout/master
  content. Groups and their addressable descendants each count as objects.
- Report explicit slide `show` separately from the effective schema-default value.
  This is not theme/style inheritance resolution. Unsupported semantic inspection
  remains visible for every part; absence of metadata is not fabricated support.
- Use independent authored two-master fixtures and shuffled ZIP order with literal
  counts through SDK and the actual Shell adapter. Tests use memory/memfs only.
- Keep research identities and case provenance outside product code and tests.
  No reference implementation/assets are copied; existing standalone notices stay.

## TDD receipt

The original SDK tests initially failed because inventory was absent and malformed
slide visibility was accepted. Original adapter variants also reproduced absent
JSON inventory. The existing independent schema-validator test failed after the
result change and before schema extension. Implementation now supplies inventory;
final maintained checks and QA results are recorded below after execution.

## Manual QA procedure

1. Read the manifest-listed IXPE presentation from its existing disposable cache;
   verify the manifest SHA-256 before using it. Do not download or ship fixtures.
2. Independently inspect its ZIP/XML slide list, owner roots and slide-only drawing
   counts with a QA parser. Run the built SDK on explicitly supplied bytes with
   explicit limits and compare those counts. No ambient product I/O is granted.
3. Capture the actual Shell inspection transcript and inspect its terminal PNG
   using the existing terminal-png renderer. The root screenshot-poe-code route
   cannot install this optional plugin; use the established selector QA route.
4. Reduce any meaningful discrepancy to an original small regression before a
   fix. Keep outputs disposable and document limitations; no rendering fidelity
   or whole-API equivalence follows from inventory QA.

## Verification receipt

- `npm run build:workspaces -- --workspace=pptx` passed the maintained three-build
  dependency closure. No fixed or cached substitute task graph was used.
- `npm run test --workspace=pptx` passed all 509 cases in 16 files. Eleven new
  inventory cases cover original/shuffled graphs, explicit/default visibility,
  malformed visibility, orphan preview media, missing type metadata and retained
  dangling/external relationships. The preview case records the QA distinction
  below. SDK tests use the public package source export and independent counts and
  Node SHA-256 expectations; fixtures remain original and in memory.
- `npm run lint --workspace=pptx` passed source ESLint and source/test TypeScript.
  Repeated after the last regression additions: passed. Scoped Prettier and
  diff checks passed; all 182 case pointers, 107 API pointers and three consulted
  input hashes were verified. Product source/test identity scan found no reference
  branding.
- The [adapter receipt](pptx-inventory-adapter.md) records 40 passing actual Shell
  cases, maintained safe-bash source/consumer typechecking, ESLint and screenshot
  review. No production adapter change was necessary: it already invokes the SDK.
- Manifest SHA-256 for the cached IXPE fixture matched
  `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
  Independent ZIP/XML and SDK counts both found five slides, five layouts, one
  slide master and twenty slide-local drawing objects, distributed 2/5/6/4/3.
  SDK inventory additionally reported two themes, 23 OPC payload parts and three
  media parts. The corpus census's two media-directory entries do not include
  the thumbnail outside that directory. Content-type-based media inventory does;
  the original unreferenced-preview regression protects that behavior. No fixture
  discrepancy was converted into an unsupported claim of editing/rendering parity.
- All generated output remains disposable. No publisher binaries, screenshots,
  reference source or downloaded assets enter the commit. No native product
  runtime or product network path was introduced. Read-only QA parsed the existing
  cached bytes through explicit QA host reads.

## Case/API accounting and limits

[Inventory accounting](../pptx/inventory-case-accounting.json) retains 141 unit
variants and 41 BDD examples from seven related owner modules/features, plus 107
slide/presentation public API records. Every selected row has its exact canonical
source pointer and remains `public-model-still-required`. This is a relevance
superset: mutators and complete collection/getter behavior are not implemented by
an immutable inspection view. The full canonical 2,700/973 case and 2,407 API
denominators remain unchanged; no new case is labeled equivalent solely from a
fixture count. Inherited and underscore-prefixed APIs are not hidden or demoted.

J01–J10 mappings remain authoritative. This milestone tests async admitted bytes,
explicit limits/authority, nullable explicit Boolean values, immutable inspection
records and retained identifiers. It does not add a second model spelling layer,
live model APIs or ambient I/O. Existing documentation drift resolutions remain
open implementation obligations. Coarse per-part unsupported records do not imply
a complete feature classifier or effective-style resolver.

The original source behavior inventory, shared Office specifications and some
audit/legal inputs were already untracked when work started. Their hashes are
recorded as consulted working-tree inputs, not implied committed deliverables.
Existing legal notices are untouched; no substantial implementation was derived.

## Delivery

One atomic local commit includes only the explicit owned source/tests and these
plan/research/usage updates. Local hash is reported after Git confirms the commit.
No push or release is authorized or performed; full pipeline/repository suites
and rendering fidelity checks were not run.
