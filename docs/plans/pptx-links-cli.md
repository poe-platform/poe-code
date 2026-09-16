# PPTX link command and SDK integration

## Scope and ownership

The command worker owns `packages/pptx/src/command-links.ts`, `links-schema.ts`,
`command-links.test.ts`, link registration hunks in `command-engine.ts`,
`packages/safe-bash/tests/commands/pptx/links.test.ts`, its exact registration in
`packages/safe-bash/scripts/integration-inputs.test.mjs`, and this plan. Existing
engine and registration edits remain owned by their original authors.

Use the common office CLI/SDK contracts and the presentation F47 requirements.
Link behavior lives in the presentation domain; the existing safe-bash adapter
supplies explicit byte I/O and publication. No host reads, network, native
runtime, downloaded test fixtures or README changes are needed.

## Original acceptance cases

- URL and relative URL byte preservation with query, ampersand and fragment.
- Two-slide navigation, schema disagreement rejected before input admission,
  missing semantic targets status 1, usage failures status 2, zero affected on
  failed prepublication changes, and destinationless dry runs.
- Click and hover inventory, add collision rejection, explicit remove selection,
  bounded run-path admission, and navigation actions available through both APIs.
- Exact structured result schema rejects incomplete records. Unsupported active
  actions remain inert and produce an explicit sanitization warning.
- Real virtual-shell `.sh` execution with quoted paths and URLs, byte-for-byte
  public SDK parity, in-place publication and failed destination preservation.

## TDD and checks

Initial four command tests failed with unsupported operation. All four passed
once the package command dispatch, argument validation and schema were wired.
The additional last-viewed/end-show case failed before explicit mappings were
added. The virtual-shell missing-slide case exposed a domain usage/semantic
error-category mismatch, reported to and corrected by the domain owner.

Run the focused Vitest file, the selected maintained pptx build closure, and
`node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/pptx/links.test.ts`.
Run package lint and exact integration registration validation after integration.
Do not run the whole pipeline. Root owns staging and commits; no push or release.

## Visual QA procedure

Use the maintained `npm run screenshot` runner with an explicitly bounded
command engine requesting `links set --help`; make unexpected input reads throw.
Inspect the generated disposable PNG and verify selection, destination, advanced
path, trigger and sanitization instructions are complete and readable. The root
CLI has no public pptx subcommand, so `screenshot-poe-code` cannot exercise this
injected virtual utility. Keep the screenshot outside staged files.

Any subsequent corpus QA uses `docs/pptx/corpus-manifest.json` as disposable
research material and reduces meaningful findings into small original cases.
Exact upstream parametrized and public API reconciliation remains in the
research owner's case and API ledgers, not product test names or assets.

## Final bounded receipt

- Nine original command-engine cases pass, including unsafe URL preflight with
  zero input reads, listed parent-path round trips, actual per-link cardinality,
  and two-link `--all` removal with affected count 2.
- Public built-package safe-bash cases: 2/2 pass (about 0.9 seconds).
- Exact integration input registration check: 107/107 pass (22.5 seconds).
- Final focused ESLint passed for the three owned package files and the new
  safe-bash test. Maintained package checks are reported by the integration owner.
- Captured and inspected `.cache/pptx-links-help.png` using the maintained
  screenshot runner. All help text is visible, including relative URLs,
  navigation, parentPath, triggers, explicit sanitization and output controls.
  This PNG is disposable and excluded from commits.

CLI read records preserve the SDK's hyperlink-node `path` and add `parentPath`
for direct reuse with CLI `--path` or SDK `path`. Parent paths are zero-based XML
child positions from the owning part root, admitted only within the selected
shape. Read operations include both click and hover unless filtered; mutation
trigger defaults to click. Missing semantic slide targets return status 1;
malformed flags or unsafe URL intent return status 2 before input access.

### Final review regressions

Read-only review identified two real DrawingML issues: text hover requires
`a:hlinkMouseOver` (shape hover uses `a:hlinkHover`), and run links precede
`a:rtl`. The domain owner fixed both with independent regressions. A new command
case independently checks the XML element emitted under character properties,
then reads the same link through the SDK and CLI and removes it by parent path.

The closed command result schema now requires nullable-string `targetReference`,
which exposes the literal relationship target. A named-slide case independently
expects `slide2.xml`, validates the result, and rejects absent/numeric values.
The focused command suite is now 11/11 passing (approximately 1.7 seconds).
