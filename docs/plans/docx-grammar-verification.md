# DOCX grammar verification

Verification of `053c65bf6` on 2026-09-14, limited to the original command
grammar/schema task. Root and safe-bash instructions and the DOCX/shared Office
contracts apply. Preserve the unrelated pipeline plan edits and archive move.

## Finding and correction

DOCX section 6.1 requires literal direct command paths and permits no additional
aliases. Joining arbitrary argv words with dots admitted `text.get` as a direct
command and `help text.get` as discovery. Both reached the injected handler.
Two original cases in the existing command test use memfs, count acquisition and
dispatch, and assert unchanged document bytes. Before correction both returned
0 instead of required usage status 2. The initial exploratory run also contained
two already-rejected paths; those were removed from the final regression rather
than represented as defects.

The parser now stops path matching at a dotted word; discovery rejects dotted
path words. Dotted filenames and explicit `--operation text.get` remain valid.
SDK and batch operation IDs retain their original dotted names. No adapter,
schema, domain-operation implementation or README changes are needed.

## Checks and inspected evidence

- Baseline maintained `npm test --workspace docx`: 23 files, 685 passes.
- Baseline and corrected `npm run lint --workspace docx`: ESLint and product/test
  TypeScript configurations pass.
- Corrected `npm test --workspace docx`: 23 files, 687 passes, no skips.
- `npm run build:workspaces -- --workspace=docx`: maintained three-workspace
  dependency closure passes.
- `npx vitest run scripts/docx-exports.test.ts`: both portable export/browser
  bundle checks pass.
- Maintained safe-bash discovery returned 1,123 files. Its derived DOCX shards
  `npm test --workspace=virtual-bash -- --test-shard=158/1123` and
  `--test-shard=159/1123` passed 7 registration and 11 I/O tests, no skips.
- Actual engine diagnostics for both rejected paths return exit 2. Rendered with
  the maintained terminal-PNG renderer and visually inspected at
  `/tmp/docx-verify-dotted-errors.png`; readable, no clipping. This is disposable
  error-output QA, not complete help or document-rendering QA.
- New red evidence: `/tmp/docx-verify-dotted-red.log` and
  `/tmp/docx-verify-dotted-red2.log`. Final logs:
  `/tmp/docx-verify-final-tests.log`, `/tmp/docx-verify-final-lint.log`,
  `/tmp/docx-verify-build.log`, `/tmp/docx-verify-exports.log`.

The prior grammar implementation/schema mapping plans describe initial missing
module failures, subsequent regressions and full-root green checks. Those are
historical narrative evidence; their raw red/green logs were not located in this
verification. Preserve their claims as history, not newly reproduced full gates.
The current bounded package/adapter outputs above were independently inspected.

## Coverage limits and delivery

The registry's 113 direct and 1,393 additional batch declarations describe input
grammar. They do not establish functioning document-operation bodies or complete
help/schema/capability rendering. The API audit/inventory and schema mapping plan
retain neutral spellings, inherited and underscore-prefixed public types, explicit
JS/security transports and documented effect corrections. Full model behavior,
source-case adaptation, semantic selection/publication and rendered document QA
remain pending; no inventory row is promoted to implemented by this review.

The correction is local to the DOCX parser, so maintained package checks plus
adapter/export checks cover its scope. No new full-root suite, native reference
build, network acquisition, downloaded-fixture qualification, release or push is
claimed. Commit only this plan and the two owned command files, with hooks enabled.
