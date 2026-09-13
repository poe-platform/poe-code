# PPTX media public interface integration

Root owns command integration, export wiring, shared discovery and delivery.
Image worker owns image admission/metadata/value files and evidence; model worker
owns slide/presentation model and returned interfaces; OLE worker owns inert OLE
insertion. Existing dirty work is outside this ownership and remains unstaged.

## Acceptance and TDD

- Reconcile docs/specs/pptx.md with the shared office CLI/SDK contracts and the
  API/test inventories, including returned underscore-prefixed media/OLE types.
- Red original command tests: objects add unsupported; BMP extension rejected.
- Add SDK-backed objects add with explicit inert byte/icon reads and program ID,
  publication protection, plural command discovery and common flags/statuses.
- Expose Image metadata, six documented image format characterizations and live
  picture/movie/OLE returns. Preserve SHA-256 identities; SHA-1 is metadata only.
- Keep exact language/security mappings and limits in docs/pptx receipts.
- Run maintained package tests, lint and selected build closure; original memfs
  tests cover serialization/reopen. Capture actual help through maintained
  screenshot route and inspect it. No renderer or media playback claim.
- Stage only owned changes, commit atomic improvements on main, report local
  hashes. Do not push or release.

## Agent QA procedure

1. Run focused new command suites and inspect JSON against returned schema.
2. Run `npm test --workspace=pptx`, `npm run lint --workspace=pptx`, and
   `npm run build:workspaces -- --workspace=pptx`.
3. Invoke built command engine with explicit inert context and no file authority
   for objects add help; use `npm run screenshot -- --no-header -o <cache PNG>`
   with the actual Node command invocation. Inspect resulting terminal image.
4. Check public exports from built package, confirm read-only metadata objects
   retain owned byte copies, and inspect staged diff for unrelated work.
5. Preserve any acquired publisher/binary QA inputs while other campaigns own
   them. This task needs no downloads or cleanup of others' QA assets.

## Verification and local delivery

- Maintained `npm test --workspace=pptx`: 242 files, 6,347 tests passed.
- After final publication-schema tightening, all 10 objects-add tests passed;
  new command suites use immediate scheduling for zero-delay cooperative yields
  and complete in roughly 0.1 seconds each without bypassing domain work.
- Maintained `npm run lint --workspace=pptx`: ESLint and both TypeScript configs
  passed. Selected maintained build closure passed (office-package,
  toolcraft-schema, pptx).
- Compiled the exact staged package source and tests in a disposable archive of
  tree `b91cc8e3794eca0ba5ff7510a9bc1eb75ab16cf7`; both TypeScript configs passed.
  The compiled staged public SDK/CLI completed a memfs XLSX-program inert-byte
  insertion, reopening and exact payload/program-ID assertion. This excludes
  unrelated working-tree integration changes from that smoke receipt.
- Inspected `.cache/pptx-public-media-help.png` from the compiled staged engine:
  objects add program alternatives and images add MIME formats are legible and
  unclipped. The disposable image is not staged; no media rendering is claimed.
- Local atomic commits: `0493fd272` image metadata/formats, `8d24ec535` inert OLE
  insertion, `2431fa2ad` live movie/OLE interfaces. The CLI/evidence integration
  commit follows this receipt. No push or release was performed.

Owned portions of command-engine.ts, images-schema.ts and index.ts were staged
against their original committed versions. Unrelated image-replacement,
sanitization, metadata and media-track work remains outside these commits.
