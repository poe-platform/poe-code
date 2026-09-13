# Opaque media-type classification

## Scope and ownership

Root owns `packages/pptx/src/opaque-objects.ts`, its existing unit test, and this
plan. The delegated safe-bash worker owns its existing opaque-object command test
and separate CLI verification plan. No root API or README edits are needed.

## Confirmed finding and implementation

Six original tiny memfs cases demonstrate that valid MIME parameters hide
otherwise recognized opaque parts from `readObjects`: active payloads, controls,
web extensions, OLE, fonts and 3D. The existing content-type parser validates the
complete declaration; classification must use its case-insensitive essence,
while the result preserves the original declaration. A quoted parameter naming
an active media type must not promote an ordinary binary to active content.

The SDK remains async, accepts explicit bytes/capabilities, and returns owned
extracted bytes. No payload is interpreted, downloaded, installed or executed.
No additional public method, enum, collection or command schema is introduced.
`objects list` and extraction share the corrected engine.

## Research accounting

Consulted `docs/specs/pptx.md`, shared Office CLI/SDK contracts, both upstream
audits and inventories, and the corpus manifest. This is additional adversarial
coverage, not adaptation of an upstream scenario. The complete existing opaque
ledger (`docs/pptx/opaque-case-map.json`) retains all 60 unit variants and eight
BDD examples; `opaque-api-map.json` retains 25 direct model obligations. This
correction closes none of those whole-model rows. Later media-public integration
receipts supersede historical absence statements only for their tested members.
No source-derived implementation/assets were used and existing legal notices
remain untouched. No corpus fixture is needed to reproduce this finding.

## Verification procedure and receipt

1. Run the focused opaque-object unit file before changing production code.
   Observed: six classification failures; 23 other cases passed, including the
   independent negative parameter case.
2. Normalize only the validated declaration used for classification.
3. Rerun SDK tests and the delegated CLI regressions. Check literal kind,
   activity reasons, original MIME declaration, fixed independent hash and
   unchanged input/extracted payload bytes.
4. Run maintained pptx workspace unit and lint checks, plus the delegated
   maintained safe-bash scope. Record actual results below before committing.
5. Stage only explicitly owned files, commit locally on main, do not push.

This focused receipt does not establish whole-spec coverage or universal host
isolation. ZIP/XML limits, unsafe paths, graph cycles, SVG, output races and
cancellation remain additive requirements with separate existing tests/receipts.

## Executed package checks

- `npm run build:workspaces -- --workspace=pptx`: passed the maintained declared
  closure (office-package, toolcraft-schema, pptx).
- `npm run lint --workspace=pptx`: passed ESLint and source/test TypeScript checks.
- `npm run test:unit --workspace=pptx`: 257 files, 6,796 cases passed in 73.62 s.
  This includes all 29 opaque-object cases and existing package/XML/security,
  graph, image, and command tests. It is not a whole-pipeline run.
- CLI red/green: the independently built three-byte active-payload input was
  omitted before the correction; all six adapter tests now pass. The worker's
  linked plan records exact capability assertions and checks separately.
- Delegated safe-bash typecheck passed source/tests and 26 consumer groups with
  expected negative assertions and cleanup. The owned adapter file passed guarded
  lint with all 25 receipts, zero warnings/errors and matched open/close accounting.
  See [the CLI receipt](pptx-opaque-media-type-cli.md) for exact results and the
  separately recorded whole-root lint outcome.
- Root independently inspected the disposable help screenshot: complete readable
  plural resource usage and explicit inert payload/publication boundaries.
