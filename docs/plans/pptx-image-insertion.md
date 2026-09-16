# Explicit image-byte insertion

Scope: F31 PNG/JPEG/GIF admission and picture insertion, bounded F33 fitting.
Root owns `image-insertion.ts`, its tests and index export; admission worker owns
header validation and evidence; CLI worker owns command engine/schema and adapter
verification. No root product logic or host I/O, no README changes, no full pipeline.

## Procedure

1. Read root/scoped instructions, the PPTX and shared Office contracts, image
   metadata/inventory implementation, upstream test/API audits and inventories.
2. Write original inline image and memfs package tests first. Initial 20 tests
   failed because the public `addImage` export was absent.
3. Admit explicit bytes and exact MIME types; own options and bytes before awaiting.
   Infer geometry only from admitted bounded header metadata, never native decoding.
4. Preserve aspect ratio for a single dimension. Both dimensions require explicit
   contain/cover/stretch. Unknown dimensions require both plus stretch. Round EMUs
   once, halfway away from zero, and reject empty geometry or rounded-empty crops.
5. Parse package XML and insert ordered picture nodes, unique shape IDs, local
   relationship IDs, media parts and content-type overrides. Keep unrelated bytes.
6. Use independent ZIP/Saxes assertions, including explicit literal geometry,
   media bytes, relationships, XML attributes, untouched parts and repeated insertion.
7. Regression red/green: mutable options changed MIME after async acquisition;
   extreme cover aspect rounded to a fully cropped image. Snapshot options and
   reject unrepresentable crop before mutation.
8. Run maintained package tests/lint/build closure, focused safe-bash adapter
   checks, and inspect help/error screenshots. Commit owned files only on main;
   no push, release, native renderer, corpus shipment or pipeline execution.

## Disposable QA procedure

Use only cache entries recorded in `docs/pptx/corpus-manifest.json`; verify hash
before loading. Open one admitted deck with explicit limits, add an original
image on slide 1, reread image inventory, and compare all unrelated package parts
byte-for-byte. Inspect any unsupported admission before changing code; reduce a
meaningful finding into an original in-memory regression. QA output belongs only
in the ignored cache. This procedure is executed interactively, not as a QA script.

## Verification

SDK focused suite: 26 tests passed after both concrete regressions were fixed.
Final maintained checks and disposable QA receipt will be recorded below.

Executed disposable QA: hash verified `IXPE-Presentation-Template.pptx` from the
manifest. Slide-local image occurrence count increased from 0 to 1; only content
types, slide 1 and its relationship part changed. Exactly one media part was
added. Output remained in memory (1,202,419 bytes); no corpus edits or shipment.
No semantic QA finding required a further regression. Native rendering was not
used; this verifies graph/byte preservation, not visual fidelity.

Final maintained verification: `npm run test --workspace=pptx` passed 3,102 tests
in 108 files; `npm run lint --workspace=pptx` passed ESLint and both TypeScript
projects. `npm run build:workspaces -- --workspace=pptx` passed its three declared
build tasks. Focused safe-bash script suites passed 49 tests. Help/error PNGs were
inspected as recorded in the CLI plan. `git diff --check` passed. Root retained
all unrelated tracked/untracked work and staged no cache files.
