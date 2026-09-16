# Handout inventory and preservation integration

Scope: F49 in `docs/specs/pptx.md`, using the shared Office CLI and SDK
contracts. This task does not run the full feature pipeline, push or release.

Ownership: the domain worker owns clean inventory/settings modules and original
domain regressions; the CLI worker owns clean schemas and existing registered
Shell tests; the accounting worker owns new handout research and QA receipts.
The root owns integration review, any necessary isolated capability wording,
verification and local commits. Pre-existing changes stay untouched and unstaged.

Review and verification procedure:

1. Establish failing original tests before changing behavior. Inspect handout
   resources through relationships, retain notes dimensions, expose bounded
   print/view inventory without evaluating layout, rendering or pagination.
2. Verify default slide text edits leave handout text unchanged; explicit
   handout-master scope permits supported literal replacement while retaining
   placeholder settings, unsupported children and all other resources.
3. Independently compare package member bytes after supported slide operations.
   State transfer/split boundaries explicitly rather than implying source deck
   settings always transfer to a newly created presentation.
4. Check CLI result schemas and capability descriptions against public SDK
   results. Exercise the configured virtual Shell with memfs, common flags,
   statuses and rejected scope combinations. Inspect terminal screenshots.
5. Run the maintained pptx package tests/lint and selected workspace build
   closure, then focused registered Shell tests and their scoped lint.
6. Admit disposable corpus bytes only by their manifest SHA-256; compare
   independent XML/ZIP observations and resource bytes. Keep QA procedures in
   this directory and outputs outside Git. Record any corpus-specific limits.
7. Review the exact owned diff, stage explicit files (only owned hunks in any
   shared dirty file), and make atomic Conventional Commits on main. Report
   local hashes separately from remote delivery; no push or release occurs.

Detailed evidence is recorded in the worker plans and `docs/pptx/handouts-*`
research receipts. Full public model coverage remains a separate obligation.

Final maintained checks passed: `npm run test --workspace=pptx` (4,125 tests,
158 files), `npm run lint --workspace=pptx`, and
`npm run build:workspaces -- --workspace=pptx` (the declared three-workspace
closure). The first full run exposed closed inspect/settings schema omissions;
those were corrected and the complete package suite rerun successfully.

Manifest-admitted corpus QA used a real handout master. Built SDK and command
inspection agreed on handout identity, notes dimensions and view properties.
Independent ZIP comparison after slide rename found exactly one changed part
among 141; every other entry, including the complete handout resource graph,
remained byte-identical. The selected corpus lacks print properties; original
unit fixtures provide positive print-property evidence.

Screenshot QA also reproduced missing settings subcommand help. That finding was
reduced to original no-I/O tests and fixed as the separate atomic improvement in
`pptx-settings-help.md`. No unrelated existing work is included in either commit.
