# Text and drawing boundary reconciliation

Scope: the requested text/font/paragraph/shape/placeholder/group/connector/picture/
table case reconciliation, with bounded original regressions for validated gaps.
This task does not execute the full implementation pipeline or claim full parity.

## Ownership

- Root: this plan, `docs/pptx/text-drawing-reconciliation.json`, its Markdown
  receipt, and historical-status corrections in `test-case-map-notes.md`.
- Text worker: `text-fitting.ts`, a new option-boundary test, and its separate
  boundary plan/receipt. Existing positional fitting validation remains intact.
- Drawing worker: clean selected drawing model files and original boundary tests,
  with ownership reported before edits and a separate plan/receipt.
- Accounting worker: read-only inventory/receipt review; no repository edits.

Existing dirty and untracked work is excluded from staging. Work stays on main;
commits are local only. No README, downloaded fixtures, or root API edits.

## Procedure

1. Read the format and shared CLI/SDK specifications, root/scoped instructions,
   pinned test/API audits and inventories, and corpus manifest.
2. Join individual retained source cases to subsequent receipts without treating
   a receipt's existence, historical execution flag, or test-file path as proof
   of semantic equivalence. Preserve missing values and each parameter/example.
3. Keep supplied-metric fitting and crop semantics visible. Enumerate layout-only
   mappings separately; do not classify an unsupported public member as private.
4. Reproduce concrete current boundary defects with fast original in-memory tests.
   Check SDK and shared command routes where exposed; use memfs for file I/O.
5. Run maintained pptx unit and lint routes and its selected workspace build.
   Review owned diffs, then stage and commit each atomic change with its plan.
6. Record local hashes, passing checks and remaining semantic gaps separately.
   Do not push, release, download corpus files, or execute the whole QA pipeline.

## Execution

Initial review found existing later receipts alongside historical global labels.
Those labels are retained provenance, not evidence of current absence or success.
Boundary implementation and the accounting index are complete for this bounded
checkpoint; full semantic equivalence and whole-public-API coverage remain open.

- Verified 1,884 unique selected rows, all baseline/source pointers, 6,606 domain
  receipt pointers/statuses, and 52 input hashes. BDD file/line joins have no
  collisions. Five rows have no domain JSON receipt and remain explicit.
- `npm run test:unit --workspace=pptx`: 252 files / 6,678 tests passed after both
  production fixes. Subsequent shadow assertions and corrected fitting test
  limits passed a focused three-file run of 113 tests.
- `npm run lint --workspace=pptx`: passed after correcting the new fitting test's
  required archive limits. Source and test TypeScript checks are included.
- `npm run build:workspaces -- --workspace=pptx`: passed the selected maintained
  closure of three builds. No whole repository pipeline was executed.
- Built-package adapter regression: `node --import tsx --test
  --test-concurrency=1 packages/safe-bash/tests/commands/pptx/selectors.test.ts`:
  45 passed, no failures or skips, including registered-shell script workflows.
- Used maintained `npm run screenshot -- --output
  /tmp/pptx-boundary-review.png --no-header node --import tsx --input-type=module
  -e '<inline driver>'`. The driver registers built pptx with source Shell and
  MemoryFileSystem, then prints text-fit help and missing-metrics/tolerance
  errors. Inspected PNG: readable complete help, statuses 0/2/2. The root
  screenshot-poe-code target does not expose the explicitly injected plugin.
  No screenshot test or QA runner file was added.

The shadow review adds original assertions and no production change. No corpus
files were needed; no native rendering/fidelity certification is claimed.
Separate local commits cover fitting, grouping, shadow evidence and the
accounting index. Hashes are reported after commit; no push/release is authorized.
