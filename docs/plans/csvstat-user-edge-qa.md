# csvstat user edge QA

1. Preserve unrelated source/index changes and use the existing literal csvstat
   registration. Delegate registered-command stress to a different agent.
2. Replay the hash-pinned CPython 3.14.2 runtime lock in a task-owned out directory.
   Verify Python, csvstat source and lock hashes against the frozen profile.
3. Compare exact JSON stdout/stderr/status for Decimal large/small exponents,
   signed zero, nonfinite/payload values, precision-28 boundaries, Unicode,
   temporal offset equality and fractional-microsecond durations. Preserve the
   new observations in docs/csvkit/csvstat-user-reference.json.
4. Reproduce discrepancies in failing in-memory tests before production fixes.
   Confirm scalar maxprecision for 1e10000, +/-1e309 and mixed 1e309/0.125.
5. Run maintained domain test/lint and selected safe-bash build closure. Run
   registered csvstat/csvkit tests, exact discovery checks and safe-bash typecheck.
6. Capture the actual built registered detailed report using the repository
   screenshot utility; inspect labels, frequency continuations and total rows.
7. Record blockers separately from passes. Remove only this task's temporary
   evidence after recording results. No README/Git/publication actions.

Red evidence: native scalar maxprecision returned 0, 0, 3 with status0 and empty
stderr. The new regression first failed: JavaScript returned -9973 rather than
0 for 1e10000/2e10000. Agate uses math.isnan/math.isinf, which convert even finite
Decimals to float, before normalization. The root fix mirrors that admission
check. The 20-case native JSON sweep improved from 18 matches to 19 matches.

The remaining sweep case, 1e-10000/2e-10000, produces a full JSON report in the
reference but status78 with no stdout and an explicit Decimal arithmetic exponent
budget diagnostic in JavaScript. This shared arithmetic limit remains a blocker;
its exact expected and actual result is retained in the fixture's blockers list
and is excluded from passing compatibility cases.

Independent stress procedures/results are in csvstat-user-stress-qa.md. The
actual detailed-report screenshot was viewed: aligned labels, null exclusion
annotation, correctly indented frequency continuations, sample stdev, Unicode-free
text metrics and final row count are readable and correct.

Final checks: maintained domain tests pass 2,607 cases in 47 files (one existing
skip and six TODOs remain blockers). Domain lint/source/test typing pass. The
selected safe-bash closure passes ten maintained builds/postbuild. Focused
registered-engine tests pass 291 cases and discovery checks pass 109 cases,
without skips/TODOs. Focused integration ESLint passes. Maintained safe-bash
source/tests and all 26 public-consumer groups pass typecheck; three negative
fixtures reject as required. git diff --check passes; staging is unchanged.
Task-owned temporary evidence is purged after these results are recorded.
