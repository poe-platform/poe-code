# Native SQL cancellation edge QA

1. Exercise the explicit MSSQL native request binding with an admitted query and a throwing synchronous interruption callback. Capture the abort listener in memory so escaping errors fail an assertion instead of becoming an asynchronous host exception.
2. Establish a failing regression before changing the adapter. Verify the original exception is `request already completed` from the interruption callback.
3. Contain interruption exceptions inside the abort listener. Drain the admitted query, dispose the transferred result, roll back and release once. Keep caller cancellation authoritative in actual Shell execution.
4. Run focused native adapter regressions, maintained csvkit lint and the selected safe-bash build closure. Have a different agent verify command-level late fetch, commit cancellation and throwing interruption using in-memory services.
5. Record exact measured results separately from live-service blockers in docs/csvkit. Do not treat injected driver tests as MSSQL service qualification. Preserve staging and unrelated edits; do not commit, push or publish.
