# Promise settlement integration gate

Main runtime `c6e146fca` includes the independent collection repair `39b20fd30`
and Promise settlement identity/journal repair `c6e146fca`.

Session 50809 runs the maintained package route:

`npm test --workspace=@poe-code/safe-js -- --reporter=default --reporter=json --outputFile=/tmp/safejs-post-promise-settlement-integration-results.json`

All 100 filesystem contract checks passed (0aaff3). The unit stage is live.
Keep main runtime and test sources fixed until terminal, and do not restart
a quiet live run. Further experiments use isolated copies.

The preceding full gate passed 28,606 tests, failed 14, and skipped 47 across
1,260 files. Those failures concern Promise own-property admission and locale
month names; the settlement repair does not claim to resolve either policy.

No push or release during the hold. Local commits, remote delivery, and
publication remain separate milestones.

During the full run, the adversarial corpus reported a failure at roughly
791 ms. Its standalone rerun passed in 635 ms (a06d50). The harness has an
internal 750 ms wall-clock ceiling in addition to the test runner timeout.
This suggests a duration failure, but the full terminal error/report must
confirm it. Do not increase the limit or claim it fixed based on a rerun.
All main runtime and test sources remain fixed for the full run.

A separate instrumented copy of the corpus retained its semantic checks and
measured each stage without altering the repository harness. After correcting
a quoting error in that diagnostic copy, it completed in 824 ms (3ab671):
deterministic runs 161 ms, recursion 89 ms, Promise checks 229 ms, missing-module
handling 92 ms, and resource checks 202 ms; regex and snapshot-depth checks
together were under 5 ms. This is profiling evidence, not a passing gate.
CPU-versus-wall timing is being checked before deciding on a repair.
The next diagnostic used 646.386 ms of process CPU but 1,127.650 ms of wall
time (f2d79a), consistent with substantial scheduling delay during concurrent
verification. This does not justify weakening the corpus's functional coverage
or changing its limit without the terminal failure details. Main's source is
still unchanged and the same full-run handle remains live.

Session 50809 is now terminal (77fd24): 28,627 passed, 15 failed, 47 skipped
across 1,264 files. The 14 earlier failures remain, plus the adversarial corpus.
The JSON report confirms the corpus failure but its assertion message truncates
the nested cause; duration remains a diagnosis to investigate, not a confirmed
fix. Runtime and tests stayed fixed until this terminal result. RegExp import
integration can now proceed separately. No push or release occurred.
