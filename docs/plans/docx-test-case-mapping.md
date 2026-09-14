# DOCX test case mapping task

Task: `map-all-upstream-tests` only. Documentation/research on `main`; local
commit only, no push or release. Later pipeline tasks remain pending.

## Owned files

- `docs/docx/test-case-map.json`
- `docs/docx/test-case-source-evidence.json`
- `docs/docx/test-case-map-notes.md`
- `docs/docx/test-case-map-verification.json`
- This record.

Root AGENTS.md applies; no scoped AGENTS.md exists under `docs`. Read the DOCX
spec, shared Office CLI/SDK specs, both test audits, DOCX test/API inventories,
API reconciliation and public API map. Existing edits to the main pipeline plan
and the unrelated archived-plan move are outside ownership and remain unstaged.
No product implementation, tests, dependency manifests, README or fixture edits.

## Agent verification procedure

1. Confirm branch/index and preserve unrelated work. Establish the documentary
   defect before writing: asserting the required map exists failed with
   `AssertionError: required 2259-row research crosswalk is absent`, exit 1.
   This is documentary evidence, not a failing product behavior test.
2. Hash the inventories, contracts, API map and pinned source files. Compare each
   retained source file with its Git blob at the inventory commit, independent
   of the checkout's empty index. Keep source and fixture bytes unchanged.
3. Collect unit definitions/parameter bindings without executing tests or fixtures
   in an isolated temporary environment. Use the pinned pytest/pyparsing versions
   from the audit, source via PYTHONPATH, disabled bytecode/cache writes and an
   invocation-owned collection hook. Preserve each original `node_id`; compare
   sets against the inventory, not only totals. Parse source ASTs for assertion,
   setup/return and fixture dependency evidence. Do not interpret generated pytest
   parameter IDs by splitting punctuation.
4. Parse every feature with Behave, walk expanded scenarios, and compare the
   `(source_file, line, expanded_name)` sets. Preserve example columns, expanded
   steps and tables. Match every step to its registered function and arguments
   without executing it. Retain 650 identities and all 1,856 matched steps.
5. Assign each row to its owning feature task and neutral TS path/title, with its
   semantic observations, exact edge bindings, source commit, mapping/difference
   rules and pending red/green evidence. Review assignments by source behavior;
   do not classify a parameterized alignment case as a merge because a parameter
   says `bottom`, or delay image construction cases to residual adaptation.
   Keep private wrapper behavior as observable state requirements where possible;
   make no architecture-only exclusion merely from a leading underscore.
6. Independently reparse the final map and inventory. Compare unit and BDD sets
   in both directions; assert exact count and uniqueness, no orphans, valid task
   order, unique target path/title pairs, complete row fields, resolvable source
   and step witnesses, exact collected parameter bindings and exact expanded
   steps/example columns. Verify zero passing/implemented/architecture-only rows
   and all red/green evidence is explicitly pending. Deliberately remove, duplicate
   and orphan rows in memory to verify the reconciliation rejects each defect.
7. Review the shared contracts and all 23 existing documentation/source decisions.
   Preserve 920 API inventory records and 1,337 API-map rows as separate evidence;
   retain their hashes and never use missing source tests to exclude public APIs.
   Resolve stale spellings for this crosswalk; leave broader specification edits
   to the next task. Check research-only naming and standalone notice links.
8. Run the repository-installed formatter on explicitly owned paths with
   `npm exec --no -- prettier --check`, plus `git diff --check`. Product build,
   unit and screenshot routes do not apply to these JSON/Markdown research files;
   do not present them as run/passed. No workflow changes require workflow lint.
9. Inspect the explicit index, commit only the five owned files with a Conventional
   Commit, and verify the resulting file list and preserved unrelated status.
   Do not push, release or mark any later task complete.

## Implementation handoff procedure

Before implementing a feature, select **all** rows whose `owning_task.id` matches
that task, plus its API/format/security cases not covered by the source suite.
Write each original failing TS case first and record command, actual failure,
source revision and durable evidence under `docs/docx`. Plans and QA steps stay
under `docs/plans`. Validate a behavior failure rather than counting an unrelated
build/import/setup failure as its red assertion.

Only then implement the behavior, run maintained scoped checks and populate each
passing record with command, result, revision and evidence link. Every planned
path/title must resolve to an actual assertion before its row closes. An existing
shared implementation needs the new original assertions too; source passes are
not target passes. For parameterized target tests, show exactly which table row
exercises each source invariant. Any consolidation needs explicit many-to-one
semantic evidence, not merely a common filename.

The SDK foundation tasks precede several feature tasks in the current plan.
If an earlier task actually introduces a later-owned behavior, transfer its rows
to that earlier owner and write their failing cases **before** implementation;
do not implement the behavior first and use this proposed ownership to defer TDD.
Task IDs are authoritative; rederive numeric order if the plan changes. The later
`adapt-upstream-*` tasks close residual gaps and verify evidence; they do not own
or postpone any initially assigned feature cases. Tasks with no source rows still
owe their independent specification/API/security tests.

A public behavior remains a visible gap until passing original assertions exist.
Architecture-only changes require evidence that a mechanic is genuinely private
and no public behavior disappears. Inherited members, enums, collections, helpers,
returned views and underscore-prefixed documented APIs remain in scope.

Never import source test identities, code, fixture names, copied artwork or
branding into product/tests. Use original in-memory assets and memfs mutations;
retain required MIT notice separately for substantial derived material. Do not
delete disposable QA fixtures before meaningful findings are reduced and their
owning cleanup task is authorized.

## Results

See the [verification receipt](../docx/test-case-map-verification.json) for input
hashes, source verification and final accounting. Research mapping is complete;
all 2,259 target adaptations and their red/green results remain pending. No source
suite pass, product pass, visual QA or release is claimed by this task.
