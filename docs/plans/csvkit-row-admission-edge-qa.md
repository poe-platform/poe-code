# CSV row and argv admission edge QA

Use in-memory canonical regressions to reproduce row serialization allocations
before output denial and actual Shell argv limits becoming internal errors.

1. Reproduce the row CR-normalization allocation with a split spy and zero output
   allowance. Confirm native escape/timedelta errors keep their ordering.
2. Validate exact UTF-8 at surrogate boundaries spanning fields and terminators,
   retained-row admission, and work denial before unbounded serializer scans.
3. Have an independent agent exercise the registered raw tools through Shell,
   delayed cooperative cleanup, invocation reuse, and argv rejection before reads.
4. Fix only validated defects, then run maintained csvkit tests/lint and selected
   workspace build closures. Run focused registered Shell tests, exact-file lint,
   and integration inventory checks. Render representative output and inspect it.
5. Record results and remaining compatibility/allocation blockers in docs/csvkit.
   Purge owned temporary evidence; preserve all unrelated edits and staging.

No native reference recapture, README changes, commit, push, or release is part
of this procedure. Focused checks do not qualify full csvkit compatibility.
