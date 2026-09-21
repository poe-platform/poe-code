# Bounded workbook model verification

Verified on September 19, 2026. This records domain-model coverage, not complete
Gnumeric format or native command parity. README files were not edited. No
commits, pushes or publications were performed.

## Reference identity

The official Gnumeric 1.12.61 archive was freshly acquired and extracted only in
`out/ssconvert-workbook-source`. Its SHA-256 was
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.

The existing [reference profile](reference-profile.json) was preserved unchanged:
SHA-256 `111b2a50a5df70f73734f536660a74317a193ff8c026823156918fcfc6402fdc`.
Its fresh reference runtime captures Gnumeric 1.12.61, GOFFICE 0.10.61,
GLib 2.84.4, GTK/GDK 3.24.49, libgsf 1.14.53, Pango 1.56.3, Cairo 1.18.4,
Debian 13/aarch64, C locale and UTC, with dependency/plugin activation identities.
The profile remains incomplete; no missing profile qualification is upgraded.
No native ssconvert was invoked in this implementation task or unit tests.

The captured GLib release archive was independently authenticated against
`8a9ea10943c36fc117e253f80c91e477b673525ae45762942858aef57631bb90`;
`glib/gunichartables.h` declares Unicode 16.0.0. Sheet folding uses Unicode's
16.0.0 default full C/F table, with no normalization or Turkic override, independent
of the host JavaScript lowercase version. Original CaseFolding.txt SHA-256:
`6f1f9c588eb4a5c718d9e8f93b782685e5c7fec872cf05e8e6878053599e09bb`.
Its Unicode license notice accompanies the emitted table. Gnumeric/GLib source
is QA evidence only, not a runtime dependency or fallback.

Source files reviewed inside the authenticated Gnumeric archive:

| Source                      | SHA-256                                                            | Validated behavior                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gnumeric.h`            | `13a482cfdd964ac7ae9440a588e495d30998df73a7c5b48f0c4acd56fcf4986d` | Defaults 256 columns/65,536 rows; minima 128; maxima 16,384 columns/16,777,216 rows                                                                                       |
| `src/sheet.c`               | `dd06712b10126b59b2c42601878abc12fe29f08003bcfc0c7ec36b09bcc8059b` | Size validation requires powers of two; stored-cell extent includes blank/hidden cells and returns a reversed range for empty storage; sheet hash uses UTF-8 case folding |
| `src/expr-name.c`           | `bbd67847241cc532f9238c85b195735ff5deb860a1a71a7170bb246cef75c353` | Names use exact spelling, local names shadow global names; ordinary same-scope duplicates fail; permanent/placeholder import recovery is separate                         |
| `src/workbook.c`            | `de53f7d4de50428f9e76e055bb5cad114db5526cf4bda382b28885f874554d03` | Ordered sheet attachment and workbook calculation/iteration state                                                                                                         |
| `src/xml-sax-write.c`       | `5605cd67d0be77854c0f28e1cab71bcae99175fa8edca8fa62d10e4a6ba7a013` | Date conventions, shared expression identifiers, array dimensions and conditional cached-value serialization                                                              |
| `src/cell.c`                | `a3efeaf3ca74b8c4a46acee842615bd3a4cc6b89d3bd44c8f19033b93eece983` | Array assignment does not itself check partitioning; overlapping import behavior must not be guessed                                                                      |
| `src/sheet-merge.c`         | `9ee3afcf5ca601a531bda9f93f4f8265bbfc35518735633acf167526ac18e64f` | Merges require sane in-bounds ranges and reject intersections                                                                                                             |
| `plugins/excel/xlsx-read.c` | `1f67172ac852954f1f74dbd34afce5f00233e7f8b0fafbfe9f9cf8d0308413b9` | Three visibility states; autoNoTable becomes ordinary automatic calculation; iteration and source date system are imported                                                |

## Implemented and exercised

The package's sparse arrays contain only stored cells. Capacity and stored-cell
extent are separate; no sheet grid is allocated. The engine now retains complete
workbook state through import and ordered updates and owns nested records rather
than retaining mutable codec or caller aliases. Snapshots are deeply frozen.

Original cases distinguish missing cells, typed blanks, empty strings, displayed
text, style and number formats; retain numbers including serial 60 without Date
conversion; retain both source date systems; preserve boolean/error cells, formula
text and absent versus cached blank/number results; and round-trip shared/array
group records, rich text and UTF-8 byte offsets. Row/column metadata, merges,
sheet visibility/order, active sheet/view, scoped Unicode names, detached scopes,
dependency ranges, properties and iteration/calculation state survive updates.
Unsupported-record annotations retain their explicit disposition and owned raw
JSON-like payload without inventing format fields or decoding unknown records.

Invariant cases cover same-scope name conflicts, exact-spelling case distinctions,
local shadowing, Unicode sheet case folding, absolute A1 addresses and Gnumeric
maxima, duplicate addresses/axis indices, invalid sizes, range intersections,
formula membership, detached active-sheet denial, named positions and dependency
ownership. Repeated updates retain address order and last-write behavior.

Ownership cases reject cycles, foreign functions/prototypes, symbols, accessors,
sparse/custom arrays and malformed structures before external effects. Rich-text
boundaries are checked against UTF-8 character boundaries. Existing engine realm,
cleanup, cancellation, producer-byte ownership and operation-order tests continue
to pass. This adds no new host sandbox or replay infrastructure guarantee.

The independent agent authored 39 stress cases, reproduced 35 failures before
repairs, and verified the final package suite and lint. Root retained integration,
exports, documentation and Git ownership. The final budget review tested exact
comparison limits across attached and detached sheets, invalid public caps and
CLI failure without encoder/write/stdout or destination namespace changes.

## Safety limits

Existing sheet/cell/operation and byte budgets remain enforced. Optional host
limits `workbookNodes`, `workbookTextBytes` and `workbookWork` are finite
nonnegative safe integers. Node admission counts keys/values before copying;
UTF-8 text admission includes keys and stops scanning on denial. Ownership depth
is capped at 128. Pairwise merge comparisons share one work cap across all
attached/detached sheets within a snapshot and no longer allocate prefix arrays.

Without explicit metadata caps, the finite node allowance is inputBytes plus
32 times cells, operations and sheets; text allowance uses 256 instead of 32.
Relationship work defaults to the node allowance. Overflow fails admission.
These allowances are safety choices, not calibrated native limits or performance
passes. Caps apply to each snapshot; invocation transform counts remain separately
bounded. Native unlimited metadata acceptance and deeper records can diverge.

## Verified checks

| Check                                                                          | Result                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Failing-first retention regression                                             | Failed before implementation: workbook metadata missing and rich-text weight changed through caller mutation                                                                                       |
| Failing-first sheet conflict/extent/work-budget cases                          | Each failed before its implementation                                                                                                                                                              |
| `npm run test --workspace=@poe-code/ssconvert -- --no-cache`                   | 70 passed, four files; in-memory/memfs, no native/disk/LLM unit work                                                                                                                               |
| `npm run lint --workspace=@poe-code/ssconvert`                                 | ESLint and source/test TypeScript checks passed after final stress repairs                                                                                                                         |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`   | Selected maintained dependency closure passed: 18 builds, including postbuild                                                                                                                      |
| Final `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache` | Passed after final domain edits                                                                                                                                                                    |
| `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts` | Six passed; SDK/virtual bytes/status/channels match; conflicting names preserve destination                                                                                                        |
| `node --test packages/safe-bash/scripts/integration-inputs.test.mjs`           | 120 passed; existing exact ssconvert test registration retained                                                                                                                                    |
| Focused strict NodeNext compiler check of the integration test                 | Passed against built SDK declarations and transitive shell source; async stdin/listener fixture type errors were concretely reproduced and repaired                                                |
| Public built imports                                                           | SDK workbook helpers through `poe-code/ssconvert` and built safe-bash ssconvert registration passed                                                                                                |
| `npm run lint:eslint`                                                          | Guarded route completed, exit 0, zero errors/four warnings; 16,467 configured subjects. Completed before final work-cap validation repair; final package lint covers that repair                   |
| `npm run typecheck --workspace=@poe-platform/safe-bash`                        | Failed before source checks: Public SafeFS must preserve shared SafeJS runtime identity; actual undefined, expected ./packages/safe-js/dist/safe-fs.js. No unrelated export changes or gate bypass |
| Ad hoc virtual-command screenshot                                              | Captured and inspected: conflict diagnostic readable, exit status 1; no screenshot test                                                                                                            |
| `git diff --check`                                                             | Passed                                                                                                                                                                                             |

## Remaining mismatches and unmeasured cases

- Real-format import/export round trips, exact native recovery/status/diagnostic
  bytes for malformed imported workbooks, and format-specific field loss are
  unmeasured. The JSON fixture is deliberately not a product codec. Disposition
  annotations describe importer decisions; they do not promise native opaque
  record passthrough. Importers must supply reference-qualified canonical data.
- Permanent/placeholder name recovery and duplicate-name import normalization
  remain importer work. The model rejects duplicate canonical exact-scope names;
  its invariant denial diagnostic is not qualified as native importer output.
- Overlapping array-group import overwrite/partition behavior, shared-formula
  rebasing and formula parsing/evaluation/recalculation are unmeasured here.
  The model retains expressions, groups, explicit edges and caches; it does not
  infer expression dependencies or materialize an array rectangle.
- Rendering, glyph span extensions, style-only print extents, hidden-cell content
  export decisions and native view reconstruction are unmeasured. The implemented
  extent specifically matches stored-cell extent, not rendering/print extent.
- Serial-to-calendar conversion, numerical calculation accuracy, exporter cache
  policy and byte determinism for actual containers are not qualified by preserving
  serials and cache presence in this model.
- Metadata budget calibration, large-metadata performance, and native handling
  beyond the explicit safety caps/depth are unmeasured. Limits are named safety
  divergences, not unsupported cases counted as passes.
- The maintained full safe-bash typecheck remains incomplete at its documented
  prerequisite. Focused compilation/build/runtime success does not override it.

The [manual QA procedure](../plans/ssconvert-bounded-workbook-qa.md) records the
steps. Owned acquisition, extraction, run logs and screenshot scratch were removed
after reducing these observations; unrelated `out` content was preserved.
