# Nullable paragraph alignment transport types verification

Verify the original DOCX utility against `docs/specs/docx.md`, the shared office
CLI/SDK contracts, root instructions and the safe-bash scoped instructions.
Preserve unrelated work and index entries. No push, release, README edits,
downloaded fixtures, reference build or product host/network authority.

## Bounded correction

The earlier nullable-alignment schema correction left both exported TypeScript
argument maps nonnullable. Retain the original memfs test and its two absent/set
alignment cases; add `satisfies` checks for public direct operation arguments and
the public batch item. These same values execute SDK mutation/save and CLI
publication, then assert reloaded null alignment, retained explicit false,
complete paragraph XML, Unicode and unchanged input bytes.

Before changing declarations, `npx tsc -p packages/docx/tsconfig.test.json` exited
2 with TS2322 at the null direct argument and TS1360 at the batch item. Both
errors said null was incompatible with `WD_PARAGRAPH_ALIGNMENT`. This is a fresh
compile-time red on the original memfs regression; runtime schema rejection is
the earlier defect, not a newly reproduced runtime failure.

Add null to the existing `DocxOperationArgumentMap` and `DocxBatchArgumentMap`
alignment value unions only. Preserve the neutral model spelling, enum transport,
existing domain setter, runtime schemas and shared command executor.

## Evidence review and remaining acceptance

Reviewed the retained conflict and unmatched-text raw red logs, their original
memfs assertions and subsequent green receipts. Historical runs retain their
original worktree identity; this review does not relabel them as new executions.
The API audit, reconciliation and inventory retain 920 source records, 262 enum
values, 11 enum aliases and 23 documentation-drift decisions. Whole API mapping
has 1,337 rows; historical case accounting has 2,259 variants. These are research
denominators, not counts of newly accepted behavior.

Current unit assertions cover owned producer chunks, backpressure, reentrant
cleanup, source/finalizer failure precedence, acquisition/parse cancellation,
sink failure, shared budgets, exact resource boundaries, both diff inputs,
media admission, prepublication preservation, mounted read-only capabilities,
unknown alias identities and conditional publication conflicts. Passing these
finite cases does not certify every phase/ceiling combination for every public
operation or deployed S3/WebDAV behavior.

Whole-task acceptance remains open. The whole-API register remains blocked;
Fresh built-output probes confirm `NumberingPart.new()` throws
`UnsupportedEditError` with `unsupported-edit`, and the Paragraph.element typed
getter route is absent from the actual operation registry. The alignment schema
reports `WD_PARAGRAPH_ALIGNMENT | null` in fields, sdkFields and batchFields.
The nullable-alignment gap is superseded only by the
earlier runtime schema correction and this public type correction. Unsupported,
inherited, returned, underscore-prefixed and untested public APIs remain visible
obligations. No complete per-member/source-case conformance is claimed.

## Checks

- Focused original regression and operation type/schema checks: 4 files,
  42 tests passed, no skips.
- Selected maintained DOCX build closure: successful; 5 declared build tasks,
  shared cache, 2 hits, including portable safe-fs and maintained export smoke.
- Scoped Shell adapter/registration/large-profile route using Node's maintained
  test runner: 172 passed, no failures, skips or TODOs. This is direct scoped
  execution, not the full safe-bash discovery runner or whole-shell gate.
- `npm run lint --workspace=docx`: exited 0, including product and test type
  checks. One existing type-only-variable ESLint warning, no errors. This is the
  compile-time green for the fresh TS2322/TS1360 red.
- `npm run test --workspace=docx`: 252 files, 5,190 tests passed, no skips.
  The run started before the type correction and completed afterward, including
  the modified original memfs regression. No runtime implementation changed;
  focused final regression/schema and final lint/build separately qualify the
  corrected public declarations. This is the maintained DOCX package route,
  not the root workspace-wide `npm test` gate.
- `npm run test:schemas --workspace=docx` exited 1 because `DOCX_SCHEMA_ROOT`
  was unavailable. Ten cases skipped; none counts as a schema pass. No pins,
  schema inputs or validator requirements were weakened.

No new terminal presentation changes; fresh screenshots, corpus campaigns,
document renderers, deployed-provider QA, packed-consumer checks and the full
repository gate were not executed and are not passes. Only the bounded type
correction and its original regression are eligible for an atomic local commit.
