# Pandoc final acceptance audit

The original pipeline remains incomplete. This audit does not authorize README
application, sibling SDK changes, push, publication or a reduced delivery scope.
Evidence belongs under `docs/pandoc`; this document is the agent procedure.

## Procedure

1. Read root/scoped instructions, record main HEAD and dirty paths, and preserve
   unrelated edits. Review contract, upstream ledger, public exports and task commits.
2. Run the maintained uncached `npm test`, `npm run lint` and `npm run build`.
   Keep build and test artifact production sequential for the final rerun. Preserve
   declaration-derived membership, native npm hooks and Git fixture isolation.
3. Reproduce reported failures before changing code. A missing archived-plan
   dependency in the frontmatter demo test reproduced with 1 failure/16 passes.
   Replace the incidental host document with an original memfs document; verify
   the same loader/parser/renderer route (17 passes). Run maintained scope lint.
4. Investigate codec/Office timeouts with focused reproductions. Do not increase
   timeout limits or delete coverage to pass. Retain failing full-run evidence and
   distinguish successful focused checks from full integration acceptance.
5. Probe built public SDK and actual Shell/plugin directions and flags. Match
   every contract option/profile to implementation and independent evidence;
   retain rejected required behavior as unresolved, rather than changing scope.
   Inspect current graph assertions: the current public test requires PPTX engine
   inclusion; older text-only exclusion evidence does not qualify that graph.
6. Check loss/errors, budgets, resources and portable graph tests, expanded
   formats and independent QA. A matrix, round trip, fixture count or gate test
   alone does not close upstream coverage or renderer requirements.
7. Reconcile task statuses: Office tasks with missing APIs/QA, README-dependent
   delivery and unresolved coverage/visual qualification remain open. Validate
   the actual pipeline with `poe-code pipeline validate` after edits.
8. Commit only verified atomic owned changes and relevant plan/evidence. Exclude
   prior dirty plan hunks and public-wiring logs from task commits. Report local
   hashes and exact paths. Archive no unresolved task; do not push or release.

## Owned atomic improvement: deterministic frontmatter regression

Paths: `packages/toolcraft-design/scripts/scripts.test.ts`, this procedure and
`docs/pandoc/final-audit-frontmatter-{red,green,lint}.log`.
Only the test changes: use memfs through mocked filesystem reads for the original
frontmatter example, preserving actual demo loading, argument parsing and rendering.
No production CLI visual behavior changes, so new screenshots are unnecessary.

## Executed audit outcome

Build, repository lint, Pandoc scoped checks and actual CLI pipeline validation
pass. The fresh full npm test exits 1: the shared phase passes, but native Bash
has 37 failures caused by a missing staged Pandoc SDK metadata/declaration
closure. Three focused existing archive controls reproduce that failure. Later
workspace stages and npm posttest are not reached; full integration remains open.
Retain the archive dependency repair, all five expanded profile acceptance gaps,
README permission, sibling Office APIs/QA and independent coverage/renderers as
unresolved. The audit procedure is executed; the original final-acceptance task
is open, no unresolved work is archived, and no push/publication is authorized.

Owned result paths: `docs/pandoc/final-acceptance-audit.md`,
`final-audit-commits.json`, `final-audit-full-test-rerun.log`,
`final-audit-archive-reproduction.log`, `final-audit-projection-edges.json`
(all under `docs/pandoc`), this procedure and only the main plan audit footer.
