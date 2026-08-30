# B01 helper repair evidence

Repair candidate `57855a0293edb83bff98113123806497b4427416` changes only
`src/shell/cancellation.ts`. Its helper blob is
`a0e68c7bfb2d541964194d38ef30a4a590bec1de`, SHA-256
`2685ad5723036ef217881e3c3b5f62882a2647e287f518d3cfd4f8416fc330a2`.
The frozen focused cohort is `2d02ebe87bf7b18548190ba6a607649cef8d04e3`.

The strict selector now returns a captured throw immediately whenever its
authenticated classification is not `invoke-option`, preserving the exact reason
and authenticated control report. Unclassified throws take the same branch but
receive no report, so reason equality still cannot invent provenance. Root caller
selection remains before classification. Authenticated invokes and successful
returns continue through the unchanged invoke-ranking path.

The focused baseline was 4/8: all four budget/pipeline × observed/report B01 rows
failed, while root priority, unknown-equal rejection, genuine invoke ranking, and
close stability passed. The candidate is 8/8. The unchanged author runtime suites
are 22/22 extension, 22/22 accepted Stage 1, and 5/5 prior repair. Three strict
checks and two author negative-type checks exited 0. The isolated focused build
and emitted-module import exited 0; artifact hashes are in `checks.json` and the
scratch build was removed with exact file unlinks and empty-directory removals.

Fixture v0's mistaken successful-return assertion is disclosed in
`PREFREEZE-ATTEMPT-v0.md`; fixture v2 corrected it before the frozen baseline and
did not weaken any B01 assertion. The baseline raw TAP and final raw TAP remain
separate.

The independent isolated/moved 11/12 rejection was not rerun or rescored. The
independent original 12/12, nearby 4/4, six old malformed type rows, eight new
malformed type rows, and four mutants were likewise retained without execution.
No Runtime/Shell integration, Stage 2, timeout semantics, native oracle, or whole
repository gate is claimed. All author-owned boundaries/listeners were closed by
the tests, all child processes settled naturally, and the temporary build tree is
absent.
