# csvclean qualification procedure

Use the frozen `darwin-cpython-3.14.2-csvkit-2.2.0` profile in
`docs/csvkit/reference-profile.json`, with source archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.

1. Run the csvclean canonical tests against in-memory inputs, comparing complete
   stdout, stderr and status with `additional-operation-reference.json`.
2. Audit the executable's exact action inventory, including -a meaning, absent
   -n, and uniqueness of option spellings. Exercise CLI and SDK through the same
   engine with empty-string fill and file-level empty-column warnings.
3. Reproduce retention-budget admission with join candidates and no width check.
   Confirm the budget blocks execution instead of silently passing.
4. Have a different agent execute safe-bash stress cases using the memory
   filesystem: labels, blank/multiline records, join/fill, physical line reports,
   error ordering, stream cancellation and backpressure.
5. Run the csvkit maintained build closure, package unit suite and lint. Run the
   safe-bash focused registered tests and integration-input registration checks.

Do not count unimplemented input quoting modes 2/4/5, unavailable external
services, or unmeasured deployment profiles as passes. The frozen released
join/check ValueError is observable behavior and must remain in exact-byte
assertions. No historical _out.csv/_err.csv effects are expected.
