# Complete the pr default-registry inventory migration

The first full maintained test run after adding pr found a missed literal
92-command assertion in the explicit Node regex-provider integration test.
The actual preset correctly contains 93 commands. Preserve the failed run in
`/tmp/issue680-full-test-v1.log` and the individual reproduction in
`/tmp/issue680-full-regressions-red-v2.log`.

Update the literal count to 93 and independently require both csplit and pr in
that test. Do not derive expectations from the registry under test or modify
sealed historical cohorts. The complete affected portable-provider and stream
holdout suites pass 135 cases in `/tmp/issue680-full-regressions-green-v1.log`.
Repeat final maintained repository checks before pushing this atomic test fix.
