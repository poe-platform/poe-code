# Tesseract command wiring QA

Run against the current working tree; this verifies admission and dispatch, not
OCR recognition. The engine and recognition assets are unavailable.

1. Run `npm run test:unit --workspace=safe-bash-command-tesseract` and
   `npm run lint --workspace=safe-bash-command-tesseract`.
2. Build the selected dependency closure with
   `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
3. Run `node --import tsx --test packages/safe-bash/tests/plugins/tesseract-wiring.test.ts`.
   Check default absence, explicit registration, VFS script/pipeline/redirection,
   SDK parity and negative network/host-path authority controls.
4. Run `npx vitest run --config vitest.root.config.ts scripts/package-safe.test.ts -t 'ships tesseract command'`.
   Check isolated implementation/declarations with the workspace removed and
   canonical runtime identity. Other tests skipped by this selector are unverified.
5. Capture shell help and the option-only diagnostic through `npm run screenshot`
   with `--no-header` and an inline Node ESM driver importing `Shell` and
   `tesseractCommands`.
   Inspect the image for readable usage, explicit engine-unavailable labeling and
   a deterministic missing-operands error. Root `screenshot-poe-code` exercises a
   different CLI; this opt-in command needs its own shell composition.
6. Delete owned temporary evidence from `/out` after inspection.

## Executed working-tree results

- The SDK option-only regression failed before the fix: status 0/help instead of
  status 1/missing operands. It now passes for PSM, language and DPI.
- Command unit tests: 51 passed, no skips. Command workspace lint and source/test
  TypeScript checks passed.
- Qualified safe-bash build closure: passed, including its guarded builder and
  optional CLI postbuild; 23 workspace builds completed.
- Real-shell wiring/authority controls: 2 passed, no skips.
- Isolated runtime/declaration consumer: 1 passed; 155 unrelated cases skipped.
- Exact integration membership check: passed. Four separately selected integration
  accounting/authority checks passed; neither selection is the full runner suite.
- Repository `npm run lint:eslint`: completed with status 0, 16,162 configured
  subjects linted, zero errors and four warnings in docx/ZIP tests. The emitted
  receipt inventory exceeded the tool's displayed-output limit; the runner's
  completion summary and process exit were captured. No warning suppression or
  unrelated source changes were made.
- Shell help/error screenshot inspected: readable usage, unavailable recognition
  label, status 0/help and status 1/missing operands. The initial long driver header
  was removed from the final capture. Absolute `/out` was read-only, so generated
  evidence used the checkout's `out` folder and was removed after inspection.

No repository-wide unit/typecheck gate, OCR accuracy gate, model interpreter or
checkpoint/replay recognition run is claimed. No commit, push, release or private
command publication was performed.

Recognition, image lists/TIFF, model inference, OCR renderers and their native
exit-status matrix remain unsupported. Original/checkpoint/replay OCR execution
cannot be qualified without that engine. No publication is authorized here.
