# Live collection/value continuation evidence

Scope: `sdk-collections-values` only. The earlier enum/helper increment in
[collections-values.md](collections-values.md) remains valid. Its missing-owner
findings describe the historical graph; task 28 supplied the live types now
qualified here. No later task or whole source-test adaptation is promoted.
The [owned plan](../plans/docx-collections-values-continuation-20260921.md)
contains the agent QA procedure and delivery ownership.

## Relationship defaults

Original `relationship-default-owner.test.ts` reproduced `get` returning a
foreign default without validation. Defaults now require null or a live
relationship from the same package; removed handles reject. `pop` uses the same
admission rule while retaining missing-key versus explicit-null behavior.
Arbitrary scalar false/zero/string defaults reject as typed input, rather than
silently collapsing into absence. This is the exact existing security mapping
in public API register rows `docx.opc.rel.Relationships.get` and `.pop`, not a new
general JavaScript dictionary contract.

Original memfs CLI acceptance uses the existing typed batch operations and
SDK-backed engine. A removed default yields `stale-selection`, exit 1, one JSON
failure envelope, null data, affected 0 and unchanged input. Typed input failures
remain usage/exit 2. Nullable missing lookup remains null; missing pop without a
default throws MissingKeyError. No ambient I/O or external-target following.

Verification before the local relationship correction commit:

- `npm test --workspace=docx -- --maxWorkers=1 -t relationship`: exit 0,
  42 files / 127 matching cases passed; 4,907 cases skipped by the explicit
  filter. Skipped cases are not claimed as passes.
- `npm run lint --workspace=docx`: exit 0, ESLint and source/test TypeScript;
  one existing unused-type-variable warning in `operation-types.test.ts`.
- Focused original/default plus existing package-view cases: 13 passed.
  The added stale-default CLI case then passed with its direct counterpart.

The early accidental complete-package invocation during red authoring was
cancelled with 130 and is not verification. Initial undocumented row/shape
equality assumptions were test-authoring mistakes and corrected before the
qualified two-defect red run (two failures, three passes). No timeout increase.

No README, ignored fixture, native runtime, corpus download, push or release.

## Image resource membership

Original live collection acceptance reproduced two resources for two identical
public picture insertions. Insertion now reuses `PackageView`'s existing
admitted-image primitive and the owned part's existing `relate_to` protocol.
A subsequent separate red reproduced two owner-local image relationships;
that protocol now reuses one relationship while retaining two drawing occurrences
with distinct drawing identifiers. The existing transaction owns all changes.
Original memfs save/reload preserves two shapes, one resource and exact image bytes.

The original opaque-resource boundary case then reproduced byte-only matching
across unequal declared content types. The existing package primitive now
requires content type equality as well as exact bytes. The opaque resource is
retained unchanged and an admitted PNG receives its own supported resource.
No networking, image execution or second image/editor implementation is added.

Fresh maintained focused execution after that final guard:
`npm test --workspace=docx -- --maxWorkers=1 --exclude
'packages/docx/src/!(live-collection*|image-resource-collection|relationship-*).test.ts'
--exclude 'packages/docx/tests/**'`: seven files / 21 tests passed, zero skips.
The exclusions select original live/resource/relationship cases and the existing
reference-removal regressions; they are not a complete package claim.

## Exact live collection mappings

The [60-row continuation register](live-collections-values-map-20260921.json)
reconciles seven returned collection families: 59 supported member/type/protocol
rows and one explicit documentation-error row. Every supported row resolves to
declared typed batch schema IDs from the built public SDK. Original acceptance
extends the live graph and earlier value tests; structural/schema resolution
alone is not behavior evidence and whole upstream-case adaptation stays separate.

- `_Rows` and Sections alone add signed half-open slicing; columns and inline
  shapes retain integer lookup. Bounds and invalid numeric inputs use typed
  errors. Numeric assignment, deletion and property definition reject.
- Row/column append retains earlier live handles and updates length/order.
  Inherited part/table owners resolve through the existing model. Sections
  count/index/includes/reversed retain owner/node equality and bounded searches.
- Comments use sparse nonnegative IDs, never ordinals. Missing ID is null,
  zero is a valid ID, and creation fills the first unused ID. Empty versus null
  initials remain distinct. The erroneous collection `paragraphs` member stays
  absent; it belongs to an individual Comment.
- Relationships retain sparse string keys, insertion order, keys/values/items,
  detached copy membership, set/update/setdefault/pop/popitem/clear and atomic
  rejection of duplicate or mismatched assignments. Removed values retain handle
  identity but lose live read authority. A returned batch handle is opaque.
- ImageParts is the package's URI-unique graph collection. Its existing `.has`
  resolves the earlier proposed `.includes` signature drift; no second spelling
  is added. Appending an already admitted owned part is idempotent, and foreign
  parts reject. Inline occurrence count is independent of shared resource count.
- `_Rows`/Sections slices return JS arrays of live handles. The exact current
  signatures replace the older proposed ReadonlyArray annotations in the overlay.
  Existing `pop` has a nullable union return annotation rather than the older
  proposed overloads; runtime missing/default/error semantics remain qualified.

The overlay also records the existing `Iterator<T>` public annotations for
Comments, Sections, InlineShapes, rows and columns instead of the older proposed
IterableIterator annotations; their runtime generators preserve standard JS
iteration/order. Four inherited Sections search/reverse protocols and the
inherited relationship dictionary protocols have no pinned equivalent unit
cases. The new original tests qualify them independently, rather than treating
the upstream test inventory as the limit of public coverage.

All seven helpers/six accessors, complete 19-family enum surface, 262 named
values/261 canonical values, eleven aliases, RGB immutable tuple/reverse/search
protocols and null/false/zero formatting distinctions retain their original
acceptance. The earlier exact D04/D06/D15/D20/D22/D23 decisions remain unchanged;
no centipoint helper, source integer coercion, undocumented aliases or dynamic
dispatch are introduced. Public underscore-prefixed collection interfaces remain
in the register.

## Visual and consumer QA

All eight `node --import tsx --test packages/docx/tests/public-shell.cases.ts`
built SDK/explicit-plugin cases passed after the fresh selected build. A new
original memory-only JSON CLI case reports two occurrences and one resource,
affected 2, exit 0, no diagnostics and unchanged input under dry-run.

The actual built human CLI stale-default diagnostic returned exit 1. Executing
the owned plan with injected memfs I/O produced a temporary transcript, captured
using `npm run screenshot -- cat out/docx-task29-cli.txt`. Visual inspection
confirmed complete readable output and the fresh-location guidance without
document text or clipping. Transcript SHA-256:
`fb38012bd502667f6d3f5a2881030041f6202de6ce6179739242757e25c94d19`;
screenshot SHA-256:
`d27f03be820916c7afea0e7c9025625f027dc2199976d729819c8fff5a683539`.
Only invocation-owned transcript and image are disposable. This is CLI QA,
not a document renderer/schema or corpus claim.

## Maintained verification and delivery

- Complete maintained package execution: 239 discovered files / 5,035 tests
  passed, zero skips, 460.65 seconds. Two new files were added during that
  execution and are qualified by the subsequent fresh focused route, not counted
  in this complete-run receipt.
- After the final content-type guard and atomic test-file split, the maintained
  seven-file focused route passed all 21 cases again, zero skips (7.38 seconds).
  This includes both subsequently added files and all new collection cases.
- Final `npm run lint --workspace=docx`: exit 0, source/test TypeScript passed;
  one existing unused-type-variable ESLint warning, zero errors.
- Fresh `npm run build:workspaces -- --workspace=docx --no-cache`: exit 0,
  declared five-build selected dependency closure including portable safe-fs.
  No native asset targets were built or native schema/runtime checks executed.
- All eight built public SDK/shell cases passed again after that final build.
  The 59 supported register rows resolve to declared built batch schemas.

Local corrections are `ba0f64d04` (relationship defaults) and `7ef6d4198`
(image resource/relationship reuse and unequal-content-type preservation).
The containing acceptance commit owns the additional live/sparse collection
tests and this register/status reconciliation. All commits explicitly stage
owned paths on main. The modified parent pipeline plan remains untouched.
Remote-main delivery is unverified; no push or release was requested or performed.
Task `sdk-collections-values` is complete within its public collection/value
scope. Whole source-case adaptation and every later task remain pending.

Only `out/docx-task29-cli.txt` and
`screenshots/cat-out-docx-task29-cli.txt.png` were removed after the above hashes
and visual findings were retained. No unrelated outputs, corpus files, fixtures
or caches were cleaned up.
