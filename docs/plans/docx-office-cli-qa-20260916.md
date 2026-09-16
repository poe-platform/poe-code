# DOCX Office CLI agent QA — 2026-09-16

Execute only the bounded usability campaign in [the shared agent procedure](office-cli-qa.md).
Root AGENTS.md applies to DOCX and docs; no scoped instructions occur below those directories.
The safe-bash instructions apply when inspecting its built Shell adapter; that adapter is not edited.
Keep original inputs in an explicit `/work` MemoryFileSystem and use fixed
`2026-01-02T03:04:05Z` model metadata. Native/reference runtimes, implicit network,
ambient document I/O, README edits, push and release are excluded.

## Agent procedure

1. Read the three contracts, both audits and both complete inventories. Preserve
   historical research statuses and account for public inherited, enum, helper,
   collection, returned underscore-prefixed and untested APIs.
2. Build through `npm run build:workspaces -- --workspace=docx`; interactively
   execute built commands through the explicit VFS Shell. Author small fixtures
   with public SDK methods and bounded XML views. Record each observed variant
   under `docs/docx`, with exact commands, hashes, outputs and remaining gaps.
3. Inspect maintained terminal-renderer screenshots of root/nested help, ordinary
   edits and selection/schema errors. No saved QA runner or screenshot test suite.
4. Reduce validated usability defects into original focused tests. Observe their
   failure before editing code; run focused tests, maintained DOCX tests, scoped
   lint and selected build closure before an owned atomic commit on main.
5. Stage only owned files and this relevant procedure. Commit evidence separately;
   leave later tasks and all unrun counterpart cases pending.

## Q43 selection discovery reduction

Built Q43 returned usage 2 with null data and no effects, but its diagnostic
only said `A resource selection is required.` The inspected screenshot lacked
any selector or help route. Two original tests in
`packages/docx/src/missing-selection-guidance.test.ts` failed before code:
the CLI message lacked `--select`, and SDK validation lacked its declared help
route. Dispatch/source-consumption and envelope assertions already passed.

Add recovery information to the existing shared selection validator, deriving
the simple selector from its resource contract and the nested help path from the
validated operation ID. Preserve selection/cardinality, I/O and status semantics.
No arbitrary caller data enters the message. Existing bounded diagnostic
formatting remains in effect.

Focused checks passed 63 tests. Maintained `npm test --workspace=docx` passed
223 files and 4,963 tests. Scoped `npm run lint --workspace=docx` passed with
one existing type-only-variable warning. The selected maintained build closure
passed all five builds. A fresh Node process executed the built engine and
confirmed usage 2, null data, zero effects, no dispatch/source read, and the new
selector/help guidance. The maintained terminal renderer produced before/after
screenshots; both were inspected. Formatting and Git whitespace checks passed.

The [execution receipt](../docx/office-cli-execution-20260916.md) records the
campaign separately from these maintained verification checks.
