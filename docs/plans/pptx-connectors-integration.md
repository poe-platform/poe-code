# Connector integration verification

## Scope and ownership

Implement the connector slice of `docs/specs/pptx.md` under the common Office
CLI and SDK contracts. The SDK worker owns connector domain code, model code,
exports and original domain tests. The command worker owns command parsing,
schemas, dispatch and the existing safe-bash connector acceptance surface.
The audit worker owns connector case/API research, draft usage and corpus QA.
The root coordinates review, maintained integration checks, terminal QA and
explicit-path local commits. Unrelated files remain untouched.

## Procedure

1. Establish failing original tests before implementing each missing behavior.
   Assert serialized IDs, sites and transforms independently of SDK readback.
2. Review attached/free endpoint distinctions, signed and zero extents,
   supported geometry, valid site admission, nested owners, collision handling,
   stale/cross-slide locations and preservation of unknown geometry.
3. Verify target deletion rejects dangling references by default and has explicit
   detach/remove behavior; unknown dependent structures fail safely.
4. Reconcile every relevant parametrized and BDD record and the public inherited
   API obligations in a scoped research receipt. Keep genuine gaps visible.
5. Run the maintained `pptx` lint and unit routes, then the explicitly selected
   workspace build closure and focused existing safe-bash pptx tests. Do not run
   the whole pipeline. Verify command and SDK publication with original memory
   inputs and independently asserted package content.
6. Capture actual registered-shell connector help and a validation error using
   the maintained screenshot command. The root application command is a
   different surface from the explicitly injected virtual-shell `pptx` command.
   Inspect the disposable PNG for clipping, legibility and correct statuses.
7. Review final diffs and stage only assigned named files. Commit atomic verified
   improvements on main with Conventional Commits. Report local hashes; do not
   push or release.

## Evidence

- TDD established missing connector operations and model accessors. Additional
  original failures demonstrated numeric coercion, double-rounded group sites,
  deletion of indirectly referenced connectors, conflicting line colors,
  silently ignored removal options and an overbroad target-location schema.
  These cases now pass. A Shell fixture initially omitted required shape text;
  the original fixture was corrected without weakening product validation.
- Final `npm run test:unit --workspace=pptx`: 91 files, 2,557 tests passed.
- Final `npm run lint --workspace=pptx` passed, including source and test type
  checks. Scoped lint of the owned safe-bash test and audit test also passed.
- `npm run build:workspaces -- --workspace=pptx` passed using its declared
  three-workspace build closure. No whole-pipeline execution was performed.
- The four existing safe-bash pptx files (`create`, `selectors`, `inventory`,
  `fields`) passed through `node --import tsx --test --test-concurrency=1
  --test-reporter=dot` with their exact paths: 94 tests. The new Shell cases
  check quoted script paths, literal coordinates, SDK-identical bytes,
  attachment/rebinding, target-deletion rejection and explicit detachment.
- `/tmp/pptx-connectors-help-20260913.png` was captured with the maintained
  screenshot command and an inline registered-Shell driver, then visually
  inspected. Connector help, shape deletion help and an invalid-site error are
  legible without clipping; statuses are 0, 0 and 2. This is disposable terminal
  QA, not a shipped asset or slide-rendering claim. The later target-schema
  correction does not change these help/error outputs.
- Research receipts reconcile 138 source cases and 41 API entries. They retain
  16 source-case gaps and seven public-model gaps explicitly; operational
  counterparts and bounded XML views do not establish full live model coverage.
  Corpus admission, exact geometry retention and the two original reduced
  regressions are recorded in `pptx-connectors.md`.
- All changes comprise one connector editing capability across domain, command
  and verification surfaces. Commit only the explicitly owned files; preserve
  the unrelated work present at entry. Existing standalone MIT notices remain
  intact. No README, dependency, corpus binary, push or release changes.

This verification does not claim full presentation API coverage or independent
slide-rendering fidelity.
