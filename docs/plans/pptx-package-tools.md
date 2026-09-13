# Bounded presentation package tools

## Scope and ownership

Implement F60 extraction and manifest-directed repacking under
`docs/specs/pptx.md` and the shared office CLI/SDK contracts. This is one bounded
improvement, not execution of the pipeline or whole API completion. Work on main;
commit locally only. Preserve all changes present at task start.

- `package_safety`: byte SDK, original memfs regressions, VFS integration tests.
- `package_commands`: command routing, schema/help, public exports and command tests.
- `package_accounting`: research case ledger, language/security mappings and usage draft.
- Root: integration review, QA, maintained checks, explicit selective staging/commit.

Existing edits to command-engine.ts and index.ts require baseline snapshots and
selective patch staging. Other workers' existing files are not owned by this task.

## Acceptance and verification

1. Establish failing original tests for absent extraction/repack APIs and routes.
2. Extract admitted parts to deterministic safe output names with original part
   identities and SHA-256 recorded separately. Preserve all opaque member bytes.
3. Repack only explicit manifest members: no directory scan, ambient host I/O,
   network, native runtime or implicit resources. Validate hashes, canonical
   unique names, content types and complete relationship graph before output.
4. Verify through byte SDK, command engine and actual safe-bash VFS invocation.
   Exercise traversal, file/directory collisions, output preflight, explicit remote
   partial-output manifests and unrelated-file preservation with original memfs data.
5. Consult the pinned test/API inventories; record relevant parametrized and BDD
   cases individually without converting planned or unsupported behavior to passes.
6. Run maintained package tests, focused integration checks and relevant lint/type
   checks; inspect help through a terminal screenshot if supported by the local
   screenshot route. Do not add screenshot tests.
7. Use only manifest-listed disposable corpus inputs for optional QA. Keep source
   bytes immutable, hash-check before use, write only a separately owned disposable
   output directory, and reduce any meaningful findings to original unit cases.
8. Review staged diff against task-start snapshots, commit explicitly owned files
   and this plan using a Conventional Commit. No push or release.

## Evidence

Pending implementation and verification. Detailed behavior and case receipts live
in `docs/pptx/package-tools-evidence.md` and `package-tools-case-map.json`.

### Baseline and first corpus pass

- Package-wide baseline `npm test --workspace=pptx`: 4,432 passed, three failed
  across 183 files. Failures are in preexisting untracked sanitization tests:
  command report properties, empty-removal retained properties, and shared opaque
  notes/master retention. These files are outside this task's ownership; no
  baseline failure is counted as a passing package gate.
- Corpus QA used the manifest-listed presentation template, verified its recorded
  SHA-256 before admission, extracted/repacked in memory, compared sorted member
  identities and each member's SHA-256, and rehashed the disk source afterward.
  All 38 members matched; the source remained unchanged. No download, fixture
  addition or output file was needed. The research receipt records exact hashes.

### Final verification and delivery

- Final focused package suite: 236 passed across eight files.
- SDK tool tests: 13 passed; command tool tests: eight passed. Public `pptx` imports
  through actual safe-bash Shell: four passed, including successful extraction
  and repacking with independent member-byte comparison.
- Maintained `npm run lint --workspace=pptx` and
  `npm run build:workspaces -- --workspace=pptx` passed.
- Safe-bash `test:runner`: 498/499 passed in the working tree. The one failure
  is an existing assertion for absent `sanitization.test.ts`. The exact registry
  candidate selected for this commit (HEAD plus only the new package-tool test
  assertion) passed the affected maintained discovery test. The temporary test
  copy was deleted afterward; unrelated live registry edits remain untouched.
- Actual Shell help and invalid in-place usage were captured via the maintained
  generic `npm run screenshot` route at `/tmp/pptx-package-tools-help.png`.
  This explicit virtual command is not the root poe-code executable. Help text
  was wrapped after visual review; statuses are 0, 0 and 2. No screenshot tests
  or fixtures are staged.
- Directory admission was committed separately as `495a4c5cd`. Tool wiring in
  dirty files is selected by merging each task-start snapshot against HEAD and
  the final owned delta; only this task's changes enter the index.
- No push or release. Whole-public-API and corpus-wide conformance remain open.
