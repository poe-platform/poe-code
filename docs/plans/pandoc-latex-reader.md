# Bounded TypeScript LaTeX input

Implement only the LaTeX reader in packages/pandoc, with the existing thin safe-bash command. Preserve unrelated working-tree changes. No native fallback or TeX execution.

1. Write original failing tests for tokens, groups, environment delimiters, AST mappings, macros, resources, forbidden commands and loss policy.
2. Implement bounded syntax parsing and allowlisted macro expansion; map supported syntax to typed AST. Reject malformed input and capability failures before publication.
3. Inject include resource resolution in the command adapter; test with memfs.
4. Run maintained package tests, lint, typecheck and selected workspace build. Record evidence and coverage outcomes under docs/pandoc. Commit verified task files on main without pushing.

QA procedure: inspect AST results for a full original document, verify error diagnostics and empty output on include failure, and inspect command format availability. This change does not change the visual CLI design.

Status: complete locally. Original failing tests preceded each parser correction.
The maintained package test route passes 676 tests, including 47 original LaTeX
cases and one memfs command case; package lint/source-test typechecks and selected
workspace build pass. Inspected docs/pandoc/latex-command.png using the repository
screenshot renderer against the built command and memfs. Profile and outcome ledger
are under docs/pandoc. Commit only the dedicated plan and task-owned files; do not
stage the independently modified pandoc-typescript-safe-bash plan. No push/release.

Executed QA: run the built command with an injected memfs /book resource directory;
observe successful input expansion, strict unknown-command failure, complete raw
command/argument preservation with W_RAW_CONTENT, and missing-include failure with
empty content. Inspect the resulting screenshot for readable diagnostics/statuses.
No QA script or host fixture was added.

September 16 follow-up: audit the existing reader against the requested bounded
profile. Add an original failing test for replacement of supported Unicode,
accent and line-break commands under strict, preserved-raw and lossy policies;
complete the reserved macro names. Verify package tests, lint/typechecks and the
selected workspace build before committing this correction locally. Preserve
the unrelated plan and public-wiring evidence. No push or release authorized.

Second atomic correction: original failing tests reproduced macro control-word
merging across parameters/comments, verbatim parameter substitution and lost
boundaries in preserved expanded raw environments. Replace text reparsing outside
math with token substitution. Preserve environment wrappers and verbatim text;
validate interpolated math against forbidden primitives with an additional
original failing security case. Keep cancellation/work and allocation admission
bounded, including the existing expansion cancellation contract.

Executed QA: use the built thin command with injected memfs to convert included
macro source, reject built-in replacement and interpolated write18, retain expanded
raw source with an explicit token separator and fail missing includes with empty
stdout. Render and inspect latex-token-expansion-command.png for readable output
and diagnostics. Full package tests (1049), package lint/typechecks and the selected
workspace build pass. Commit this atomic correction locally; no push or release.

Third atomic correction: reproduce content loss from treating unknown environment
names beginning with verbatim as supported verbatim. An original failing test
requires strict refusal and full diagnosed preservation under raw/lossy policy,
including macro expansion in the unknown environment. Match only verbatim and
verbatim* in both mapping and substitution. Re-run package tests, lint/typechecks
and the selected build. Execute the built command under all three policies and
inspect a rendered screenshot before committing locally.
