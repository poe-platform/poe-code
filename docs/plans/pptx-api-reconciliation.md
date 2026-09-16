# PPTX API reconciliation verification

Scope: Documentation/research only, on main, without push or release. Preserve
unrelated work and existing disposable assets. Evidence belongs in docs/pptx;
this agent-executed procedure belongs in docs/plans. No product code or README edits.

## Procedure

1. Read root/scoped instructions, PPTX and shared CLI/SDK specs, API/test audits
   and both inventories. Confirm the reference checkout pin and clean status.
2. Read the 54 pinned API/user-guide files independently of the test inventory.
   Resolve RST directives, inherited members and source import aliases using
   syntax inspection. Follow returned interfaces and record constructors,
   getter/setter signatures, explicit raises, enum aliases and protocols.
3. Open the corresponding published pages. Record access failures separately
   from successful reader access; never claim raw hashes for unavailable bytes.
   Compare source/doc enum names and resolve prose/source inconsistencies with
   actual declarations. Keep missing source behavior distinct from a guide typo.
4. Verify all 719 original candidate IDs remain, IDs are unique, counts match
   records, all source/document hashes match, source spans are valid, aliases
   resolve, all property rows have separate read/write signatures, and all 33
   collection rows reference indexed/length/iteration entries. Check the four
   prose/enum error rows and D01–D15 against the source.
5. Read both full test inventories as JSON; verify their original unit/BDD counts
   and unchanged bytes. Do not count source test passes as new API evidence.
6. Run the maintained Prettier route on only owned Markdown/JSON files. Parse the
   changed pipeline plan using its maintained parser. Inspect the diff and local
   links; verify product files, README files and unrelated paths are not staged.
7. Commit the single coherent reconciliation improvement, staging only named
   owned files and relevant plans. Record the local hash in the completion report.
   No push, release, runtime test or CLI screenshot is applicable to this prose-only
   change. No binary cleanup is authorized by this procedure.

## Research results

- Retained all 719 candidate IDs; expanded register has 2,407 records across
  distinct kinds, including 716 enum-symbol records, 13 enum aliases, 122 source
  constructor records, 88 protocol records and four documentation-error entries.
  This mixed count is not an implemented coverage denominator.
- Recorded 33 collection contracts and 103 RST directives. Source hashes and
  declaration spans provide evidence independent of upstream test names.
- Documented D01–D15 drift decisions and J01–J10 language/security mappings.
  Exact source getter/setter signatures are separate from documented-only target
  writes. Concrete TS declarations and CLI/batch schemas stay with the next
  `define-mirrored-js-api` task; no implemented status was added.
- All 54 corresponding published URLs opened via the web reader. Raw retrieval
  returned 403, so no published HTML hash or exact Sphinx-output comparison is
  claimed. Pinned source is 1.0.2; published pages still display 1.0.0.
- No reference runtime execution, product tests, downloaded-deck mutation,
  fixture cleanup, native renderer, implicit network, README edit, push or release.

## Check results

Passed on 2026-09-13 UTC:

- Scoped maintained Prettier check on the seven owned Markdown/JSON paths.
- Maintained `packages/pipeline/src/plan/parser.ts` accepted 125 tasks, with
  `reconcile-documented-public-api` done and `define-mirrored-js-api` open.
- Structural review verified all original IDs, uniqueness/counts, 54 documentation
  hashes, 101 source hashes, declaration spans, alias destinations, getter/setter
  consistency, all 33 collection profiles and 24 enum name comparisons.
- All 2,407 records remain unimplemented. Full test inventory parses with 2,700
  unit cases and 973 BDD cases; neither test inventory nor test audit was edited.
  Inventory SHA-256: `702a7b6aaa2009050583c4ef4c2b363ef5f52bea4a59cc60aa5861e30731fa6d`.
  Audit SHA-256: `63a4ba0c9845b2d4e833288d5e7fd459684be1c25cea1712727c1e9afe32528b`.
- No test execution is represented by these document checks. Source test passes
  remain prior evidence only. Source hash verification did not execute code.

Owned commit paths: this procedure, the PPTX pipeline plan, API audit/inventory,
reconciliation findings, language/security mappings and published review receipt.
Existing unrelated untracked files remain unstaged. Local commit identity is
reported from Git after commit; no remote delivery or release is implied.
