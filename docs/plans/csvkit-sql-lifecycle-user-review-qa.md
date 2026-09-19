# SQL lifecycle independent user review

Execute the actual Safe Bash Shell with explicit in-memory driver bindings.
Use no native subprocess, network, database, ambient credential or disk fixture.

1. Issue `sql2csv --db review://owned --query 'SELECT value'` with a caller signal.
2. Hold an admitted row `next()`, cancel the caller, and have iterator `return()`
   release the read but hold its own completion. Verify public execution remains
   pending and neither result nor connection closes yet.
3. Release iterator return. Verify original cancellation-reason identity and exact
   return/result-close/rollback/session-close order, once each across disposal.
4. Run a successful query whose result-close rejects. Verify host cleanup failure
   escapes execution and the session still rolls back and closes exactly once.
5. Run existing SQL provider stress cases with the new review tests. Root owns
   exact discovery registration, maintained integration/build/lint checks and Git.

This profile qualifies cooperative injected lifecycle behavior only. It does not
qualify deployed SQL drivers or csvkit's output for an external driver failure.
