# ROOT handoff — bounded B01 helper repair passes

Candidate `57855a0293edb83bff98113123806497b4427416` resolves the frozen B01
control-failure precedence defect. No new scoped defect or missing declared API
was found. ROOT owns acceptance and any release; this is not Stage2 authorization.

- Independent freeze: `589f90eae8dfa493558b5c62221590c86805f05a`.
- Evidence commit: `f1c60f40a88c5a67920bda4b487fa068e0fbdeb0`.
- Evidence manifest SHA-256:
  `a8174968fa258aaca79927924ef213bf8c8108a0be8f529b22a0617bc83ce10f`.
- Postcommit proof SHA-256:
  `830f05ff7ed4964ebc585bd08635704f133694b40ae050f45d2cf69cff846a41`.

In EACH isolated-built/moved mode: unchanged extension 12/12, original Stage1
12/12, nearby repair 4/4, and new tiny cohort 2/2, separately. Both positive type
fixtures pass; original six and extension eight malformed rows produce exact
targeted diagnostics. The exact repair revert compiles/loads and fails unchanged
E07, after the candidate passes that same witness. One behavioral kill, no extra
old mutants or duplicated author suites. Moved repetitions are not new controls.

Both new read-only verifiers pass. Candidate raw-tree delta is helper-only, exact
two-line source repair; declarations are unchanged byte-for-byte. The evidence
commit authenticates 158 owned members and reconstructs 155 changed paths, all
inside this new version, versus parent 02ccea66d1e7983056c0ed114f8842fbd7ec3255.
The later audit commit contains only this handoff, COMMIT-AUDIT-v1.json,
COMMIT-PROOF-v1.json.gz and its two capture logs. Its hash is reported externally
after commit, not embedded recursively.

All 218 old-layer files are preserved with only this authorized append excluded;
old 11/12 and 10/12 histories and old verifiers remain intact. Author claims and
prefreeze correction remain separate. No unexpected failures occurred in this run.
Scratch is removed, foreign staging preserved against contemporaneous HEADs, and
no product/private/runtime/public files are changed. R08 and
InvocationCancellationOwner remain DESIGN ONLY. See REPORT-v1.md for bindings,
scope and reproduction. Stop here pending ROOT's decision.
