# csvsql implementation QA

1. Preserve unrelated edits and staging. Authenticate the csvkit 2.2.0 source archive against SHA-256 147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b. Inspect CSVSQL and pinned Agate-SQL/SQLAlchemy sources. Native Python is a research oracle only.
2. Reproduce blocked database execution with failing in-memory argv and SDK cases before implementing it. Add differential captures for validation order, inferred DDL, text length controls, query splitting/file precedence and SQLite effects.
3. Verify injected database connect/begin before CSV consumption, per-table hooks, create/overwrite/checkfirst, constraints, chunked inserts, final query CSV and commit after output success. Verify failures and cancellation rollback and drain iterators/results/session exactly once.
4. Use a different agent to stress/fix the actual safe-bash registered executable. Root retains integration/export/Git ownership. Use memfs/in-memory inputs; no native programs or databases in canonical unit tests.
5. Run maintained uncached csvkit build/test/lint, then relevant safe-bash tests and integration type/build checks. Use an ad hoc screenshot for CLI-visible behavior. Keep unmeasured drivers, unsupported values and diagnostics explicit blockers.
6. Reduce measurements to docs/csvkit and semantics to docs/specs. Purge only this task's temporary evidence in out. Do not add README content, stage, commit, push or publish.
