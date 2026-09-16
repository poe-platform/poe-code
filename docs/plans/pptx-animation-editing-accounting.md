# Animation editing accounting and bounded QA

Scope: F46 in `docs/specs/pptx.md`, with `office-sdk.md` and `office-cli.md`.
All implementation stays in `packages/pptx`; safe-bash owns only command adapters.
This task does not run the full pipeline, push, release, edit README files, fetch
fixtures for unit tests or introduce product host/network access.

Ownership: domain agent owns authoring and original domain tests; command agent
owns operation routing/schema tests; root owns integration, semantic validation,
object lifecycle checks and exact media-creation regressions. Research owns only
this plan and the new `docs/pptx/animation-editing-*` evidence, case map and usage.
Unrelated media-track work and prior inventory receipts remain untouched.

## Accounting procedure

1. Read the pinned test and public API audits/inventories. Select every exact
   timing/animation/trigger unit identity and expanded BDD identity. Retain the
   existing media-adjacent closure, including cases without direct timing names.
2. Reconcile each original TypeScript assertion, not merely matching test counts.
   Keep absent timing, existing video and missing child-list variants separate.
   Treat insertion preserving extension bytes as an explicit security/preservation
   mapping instead of requiring destructive source timing replacement.
3. Link original F46 authoring, trigger, target/reference and preservation tests.
   New format requirements supplement the baseline; no source timing-editor API
   exists in the reconciled inventory. Keep all inherited, collection, enum,
   helper and underscore-prefixed public model obligations visible.
4. Run the narrow maintained package checks and record receipts after completion.
   The root agent stages only explicitly owned files and creates local atomic
   Conventional Commits on main. Research creates no commits.

## Disposable semantic QA procedure

Use only already available manifest-owned fixtures from
`docs/pptx/corpus-manifest.json`, verifying their manifest hash before inspection.
The retained large deck with four timing trees is a useful preserve-only sample;
the small template can exercise a supported new effect on a selected ordinary
shape. Respect the manifest's per-file limits and rights restrictions. Missing
fixtures are a visible unrun case, never a passing result or reason for unit-test
network access.

Inspect timing before and after, compare untouched part bytes, and independently
check unique timing IDs, target membership in the owning slide and resolved
condition references. Try deletion, duplication and cross-deck import of a shape
with a supported effect, then a shape mentioned by opaque timing. An unsafe edit
must reject atomically. Exercise dependent effects and missing predecessor cases.
Semantic acceptance is independent of rendering or animation playback.

Run SDK and CLI equivalents through supplied byte/VFS capabilities. Confirm
publication and dry-run behavior, structured errors, schema discovery and the
common envelope. Capture CLI screenshots through the maintained screenshot route
for visible command changes; screenshot inspection is manual QA, not a unit test.
Any meaningful failure becomes a small original memfs regression before repair.
Record actual fixture/command receipts and limitations; do not label planned QA
as executed. Do not delete another campaign's cached fixtures.

## Verification receipt

The research census independently found three
direct timing unit variants, no direct timing BDD scenarios and no timing-named
public API records. The retained focused closure contains 48 unit cases and six
BDD scenarios, plus 48 media-related public API rows (four prior enum values and
44 outstanding live model records). This is accounting, not a parity percentage.

## Integration accounting update

Final original suites pass 19 expanded authoring/SDK variants, three object-lifecycle
variants, three direct media-creation variants and ten expanded command variants.
Five authoring admission variants were added after the maintained 3,938-case run;
the final 19-case focused suite and ESLint passed separately.

The SDK now includes a typed ordered atomic animation batch. CLI bounded batch
wiring is complete. Verify rebinding the dependent trigger before predecessor
removal succeeds, reverse ordering fails, original selector tokens resolve across
the batch and no intermediate output is published. Click-group assertions must
check with/after effects share the predecessor's parallel group, not merely that
the expected reference string appears somewhere in XML.

## Final root verification receipts

- `npm run test --workspace=pptx`: 150 files, 3,938 tests passed in 43.67 seconds.
- `npm run lint --workspace=pptx`: ESLint and both TypeScript checks passed.
- `npm run build:workspaces -- --workspace=pptx`: declared three-workspace closure passed.
- Template pulse501: six unique timing IDs and empty diagnostics. Complex intro
  slide15 and incomplete drawing slide4 reject with `unsupported-edit`; hashes
  unchanged. Intro slide1 fade retains all prior timing XML across 32 slides.
- Actual animation and batch help screenshot `/tmp/pptx-animation-editing-help.png`
  inspected as legible; command exit 0. No playback verification claimed.
- Local atomic media-creation test commit: `6ba90179a`. No push or release.

Safe-bash expanded animation/batch script and discovery passed. Only final output bytes are
returned or published for batches; per-operation results contain metadata only.

Supplemental final scoped strict TypeScript passed. Root validated production/test
TypeScript against the isolated staged package after correcting index-only patch
offsets; unrelated shared-file edits remain intact. The five test-only additions
cover ambiguous name, slide/subrun targets, stale token and foreign-slide target.
The existing batch regression additionally checks original input fingerprints in
all per-operation results. No source changes occurred after the maintained test
receipt for these additions; do not inflate that receipt's 3,938-test count.
