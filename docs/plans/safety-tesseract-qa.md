# tesseract resource and failure boundary QA

Use memory VFS and explicit byte streams. The requested package-pattern document
is currently at `archive/safe-bash-command-package-pattern.md`.

1. Run `npm run test:unit --workspace=safe-bash-command-tesseract`.
   Check seeded partitions (0x5afe), all byte values, empty-chunk exhaustion,
   pending cooperative input cancellation, falsey failures, cleanup, checked
   accounting and hostile UTF8/DPI/URL arguments. Existing controls exercise
   cancellation in raster/seedfill/TSV traversal and output, quota rollback,
   traineddata malformed tables, morphology and pinned TSV geometry.
2. Run `node --import tsx --test packages/safe-bash/tests/plugins/tesseract-{wiring,boundaries}.test.ts`.
   Inspect actual Shell pipes, redirects and `.sh` VFS invocation, CLI/SDK parity,
   named output preservation, symlink aliases and same-file redirect truncation.
   Deny fetch and exercise inert credentials, model/debug paths and missing host
   executables. Failures must never select another recognition engine.
3. Run command workspace lint (includes source/test types), ESLint for the new
   Shell tests, safe-bash consumer typecheck and the maintained selected build:
   `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`.
4. Assemble with `scripts/package-safe.mjs`, install only public artifacts outside
   the checkout and inspect tesseract runtime/declarations. Require canonical
   command identity, byte argv execution and no installed private workspace.
   Do not publish any package. Purge task-owned temporary artifacts afterward.
5. Record unsupported engine/profile/runtime cells separately from passing
   admission controls. No runtime or CLI presentation changes are proposed;
   screenshots are needed if such changes become necessary.

The candidate exposes recognitionQualified=false and reads no input/model VFS
paths during recognition. No image codec, recognizer, traineddata interpreter,
segmentation or searchable-PDF engine is admitted. Named renderer publication,
conditional/exclusive writes and rollback of such writes are unsupported cells;
shell stdout redirection is destructive and offers no atomic guarantee.
Byte admission cancellation requires a cooperative source while awaiting next()
or return(); there is no promise of forcibly interrupting arbitrary callbacks.
Synchronous argv parsing has bounded byte admission but no cancellation signal;
mid-parser asynchronous cancellation is unsupported. There is no command-owned
checkpoint state; original/checkpoint/replay OCR execution is unavailable.

Results on September 20, 2026:

- Exact candidate: HEAD `ab1fa8d34101e1e7f61272973f3bc28a842043d8`, with
  existing uncommitted command sources. SHA256 of sorted non-test source paths
  (path plus NUL followed by file bytes) is
  `af77c9350acf816291e794c69324837d060f176eb575412744c25e2386f6ad4e`.
  No production source change was justified; six independent helper controls
  and three Shell controls were added. All unit tests use memory sources/VFS.
- 57 command tests and five Shell tests passed, zero failures/cancellations/
  skips. Command workspace ESLint and source/test typechecks passed; new Shell
  test ESLint passed. These are deterministic checks, not performance claims.
- Maintained selected safe-bash build closure passed, 23 builds, no cache.
  Initial build/typecheck commands accidentally used `@poe-code/safe-bash`,
  failed workspace selection, and were corrected to `@poe-platform/safe-bash`.
- Maintained safe-bash consumer typecheck FAILED: checkout peer binding requires
  root `exports['./safe-fs'].import='./packages/safe-js/dist/safe-fs.js'`, but
  the current root manifest has no `./safe-fs` export. Verified against
  `tests/plugins/qualified-current-release/peer.mjs:245` and root package.json.
  This gate remains failed; isolated tests do not replace it. No broad gate ran.
- Artifact assembly passed. An external temporary consumer installed only the
  three assembled public packages with npm scripts disabled, plus their
  declared public dependencies. Tesseract runtime, canonical command identity,
  actual Shell argv execution and strict NodeNext declarations (without
  skipLibCheck) passed. No private command package was installed. npm tarball
  packing was not run. A preliminary copy-only runtime check FAILED on missing
  `@kayahr/text-encoding`; installing declared public dependencies resolved that
  setup failure. This demonstrates command bundling, not zero dependencies for
  the entire safe-bash artifact, which still declares external dependencies.
- Node VM browser-platform bundle executed help and cleanup with denied VFS,
  environment and stdin getters, no process/Buffer/require/fetch, and explicitly
  supplied web constructors. This is conditional graph evidence, not an actual
  browser/workerd runtime pass. Preliminary mixed source/dist contract imports
  correctly failed the canonical argument brand. Mixed-realm TextEncoder and
  Uint8Array constructors failed byte admission; the graph check passed with
  consistent admitted constructors. A permanent negative control records foreign
  realm byte-chunk rejection and iterator cleanup; foreign byte acceptance is
  unsupported. No native executable, WASM or external inference runtime exists
  in the command's source closure.
- Recognition, codecs, tensors, segmentation, PDF fidelity, mature OCR quality,
  actual browser/workerd/Bun cells and OCR checkpoint/replay remain unverified
  or unsupported. Native controls were not rerun or extended by this task.
  Mid-argv asynchronous cancellation is unsupported; cooperative stream,
  raster/seedfill/TSV traversal and output cancellation were checked separately.
- No product visual behavior changed, so CLI screenshots were not run.
  Repository-wide npm test/lint/build were not run for these focused verification
  additions; no workflows or shared implementation changed.
- Task-owned assembled artifacts and the external consumer were purged after
  recording results. Evidence used repository `out/safety-tesseract`, the host's
  existing /out fallback. Unrelated edits were preserved.
- Local commits: none. Verified remote-main delivery: none. Successful releases:
  none. No publication was attempted or authorized.
