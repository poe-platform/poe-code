# Shape command QA

## Procedure

1. Run original memory-only byte SDK and command tests. Assert literal geometry,
   names, title/description, local IDs, fill/line and schema constraints. Run
   existing master shape cases to retain numeric-name/token behavior.
2. Use the actual registered Shell with an explicitly injected command engine
   and memory filesystem. Compare CLI publication against the byte SDK, then
   check independent literal expectations and unchanged input bytes.
3. Admit only cached fixtures listed in `docs/pptx/corpus-manifest.json`, after
   verifying byte length and SHA-256. Add one original preset to slide 1 through
   SDK and Shell, compare bytes and every decoded package member. Keep output in
   memory. Do not download or commit fixtures.
4. Capture actual Shell help and an invalid-preset error with `npm run screenshot`
   and an inline driver. Inspect the PNG for clipping and legibility. This tests
   the terminal surface, not slide rendering.

## Evidence

- Initial original command case failed with status 2, unsupported option. After
  implementation, the help case independently failed because shape paths did not
  accept scoped help. Both defects are covered by original cases in
  `packages/pptx/src/command-shapes.test.ts`.
- Twelve new command/SDK cases and 14 existing master command cases passed in
  focused runs. Five allocation variants cover sparse local IDs and the uint32
  maximum fallback. The
  tests use memfs or admitted byte arrays, not host fixture downloads. Existing
  master tests caught and retained affected-slide reporting, opaque object
  locations, numeric names, duplicate-name all selection and positive extents.
- Foreign identity metadata regression retains `id="not-an-id"` in an extension,
  allocates shape 2, and independently asserts shape-before-extension sequence.
- Actual Shell QA admitted the manifest's first cached fixture at 1,202,514 bytes,
  SHA-256 `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
  It added an original rectangle named QA card to slide 1 at 1in/1in with 2in/1in
  extents, RGB 124578 and an original description. Shape ID was 7. SDK and CLI
  output matched byte-for-byte at 1,202,696 bytes, SHA-256
  `7fd69347382ffbf5b244f3d31b03c81076727813a15a0e689cf3b3ddf0185588`.
  All 38 decoded package members were compared; only `/ppt/slides/slide1.xml`
  changed. Cached host input and VFS input remained unchanged. Output stayed in
  memory. An initial QA assertion incorrectly decoded Shell's string stdout as
  bytes; correcting that assertion produced the successful evidence above.
- `/tmp/pptx-shapes-help-20260913.png` was generated with the maintained screenshot
  command and inspected: help and validation error are legible, with statuses 0
  and 2. Later wording explicitly distinguishes null fill/line (disabled) from
  title/description/lock (remove direct metadata).
- A later original CLI regression reproduced nullable line width rejection at
  argument parsing. CLI/schema now accept null, remove explicit width and retain
  both line color and fill. All 12 command cases passed again after this fix.
- Final `/tmp/pptx-shapes-help-complete-20260913.png` was recaptured and inspected
  after both null semantics corrections. It displays the complete help, including
  nullable inherited line width, without clipping, and retains correct help/error
  statuses 0/2. No screenshot is staged.
- Reserved color value `solid` selects solid fill without inventing color. The
  original command case verifies existing solid RGB is retained, and a no-fill
  transition becomes empty solid with absent color. Schema accepts the same value.
  `/tmp/pptx-shapes-help-solid-20260913.png` was captured and visually inspected
  after this final help addition: all lines remain legible, statuses remain 0/2.
- Runtime SDK selector validation regression reproduced an input read before
  rejecting truthy string controls. Exact option keys and types now fail before
  input admission; read operations reject mutation flags. A two-shape original
  case prevents `all: "false"` from becoming a bulk edit. This brings command
  cases to 13; focused run includes the 14 retained master cases.
- `npm run lint --workspace=pptx` passed before final test/schema refinements;
  final maintained validation is recorded by the integration owner.
- `npm run build:workspaces -- --workspace=pptx` passed (three builds in its
  declared dependency closure). The three registered safe-bash pptx files passed
  via `node --import tsx --test --test-concurrency=1 --test-reporter=dot
  packages/safe-bash/tests/commands/pptx/create.test.ts
  packages/safe-bash/tests/commands/pptx/selectors.test.ts
  packages/safe-bash/tests/commands/pptx/inventory.test.ts`: 89 tests including the
  new actual Shell shape case. A separate name-filtered run also passed that case.
- Second cached-fixture check edited existing subtitle placeholder ID 3 on slide
  1: name, title and RGB line color only. Placeholder idx 1/type subTitle/orient
  horz/size full remained identical. Direct transform remained absent; exact
  `ph`, `bodyPr` and `lstStyle` markup remained unchanged. Only slide1.xml changed.
  Output was 1,202,590 bytes, SHA-256
  `d9b88cff73229d61da0e5b5945d6a89b4b9347e4aa8c7311050fb218601d8927`.
  QA initially assumed public text/offset fields; using documented `markup`
  access corrected those assertion setup errors. No product workaround was needed.

No README edit, native document runtime, product network access, downloaded unit
fixture, commit, push, release or whole-pipeline execution was performed by this
worker. The integration owner owns commits.
