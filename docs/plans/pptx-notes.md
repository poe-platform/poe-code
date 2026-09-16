# PPTX notes editing and associations

Scope: F48 speaker body read/create/edit/removal, explicit note shape/master text
edits, and F07/F08 graph retention during slide copy/delete/import. Shared CLI/SDK
contracts apply. This is a bounded implementation, not whole-public-model parity.

## Ownership

Root owns integration hunks in command-engine.ts/index.ts, research receipts,
usage draft, verification and local atomic commits. Existing image/media hunks
are excluded from commits. Notes domain worker owns new domain/schema/command
files. Safe-bash worker owns new notes CLI tests and its plan. Graph worker owns
slide-import.ts, original graph tests and its plan. No README, downloaded fixture,
push, release or whole-pipeline work.

## Acceptance and accounting

1. Reproduce missing notes commands and competing-notes-master rejection before
   implementation. Use original memfs packages and independent XML assertions.
2. Keep body speaker text separate from slide-image, date, header, footer and
   slide-number placeholders; absent body is null, and reads never create parts.
3. Preserve unsupported XML and resources. Explicit full speaker replacement
   changes only the selected body; original note shapes use explicit scoped text
   frame operations. Multiple bodies and ambiguous master creation must fail.
4. Verify SDK and public safe-bash commands, shared output/selection errors,
   schema and capabilities. Record every notes-related source parameter/BDD row
   and all inherited/public members in dedicated research ledgers.
5. Run package tests/lint, selected maintained workspace build closure, and
   focused safe-bash checks. Review help/error screenshots. Commit named owned
   files and integration hunks only after checks; never push.

## Disposable QA procedure

Use only existing cached inputs listed in docs/pptx/corpus-manifest.json. Verify
SHA-256 before read. Inspect associated notes and independently compare body
placeholder text/counts using ZIP/XML tooling. Edit supplied bytes in memory,
verify only intended note-part changes and unchanged source bytes. Do not fetch,
render with a product native process, ship or clean up other campaigns' fixtures.
Reduce any meaningful discrepancy to a small original memfs regression.

## Initial evidence

Safe-bash notes list failed with exit 2 and Unsupported operation. Import source
contains an explicit rejection of notes masters when destination already has one,
and of multiple source notes masters. Dedicated graph tests will establish red
and green behavior. Full notes live-object API remains a separately recorded gap.

## Completion checks

Final selected workspace build closure, package lint/typechecks and maintained
package tests passed (157 files / 4,113 cases). Seven public safe-bash notes cases
passed against built exports; help/error screenshot inspected. Two manifest
inputs matched independent logical speaker text and retained every unrelated
package member after in-memory edits. The original notes regression total is
52 package cases plus seven CLI cases. Twelve review cases established concrete
input-validation failures before fixes. Full notes live-model parity and
competing-master import remain explicit gaps, recorded in the research receipts.

The initial full-suite attempts caught tests deliberately added red by workers;
final stable-snapshot runs passed. A concurrent dependency rebuild temporarily
removed declaration files during an early lint run; the final build then lint
sequence passed without changing dependency configuration or suppressing errors.

Only named owned files and notes-only integration hunks are staged. The initial
image/media changes, shared specs/audits supplied untracked, and disposable QA
fixtures are excluded. Local commit delivery only; no push or release.
