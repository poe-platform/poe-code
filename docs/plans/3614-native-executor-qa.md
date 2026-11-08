# Native executor QA

Run these checks independently from the unit suite after the normal build. Keep
native process startup outside unit deadlines; store temporary evidence under
`out/` and purge it afterward. On a loaded machine, allow up to 60 seconds
for successful native process startup; do not widen unit deadlines or production
executor limits.

1. Import `runCommand` from `scripts/verify-safe-publication.mjs`. Execute
   `/bin/sh -c 'exit 7'` with `timeout: 60000`; require rejection with `code: 7`.
2. Execute `/bin/sh -c 'while :; do :; done'` with `timeout: 50`; require
   rejection with `signal: "SIGKILL"`.
3. Execute `/bin/sh -c "printf '%2000000s' x"` with `timeout: 60000`; require
   rejection with `code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"`.
4. Query the actual `git rev-parse --local-env-vars`. Run the workspace unit
   planner against an owned in-memory manifest fixture and mocked child spawn,
   with every returned name present in an immutable parent environment. Use the
   actual, unmocked Git query in the planner. Require every spawned child's
   environment to omit all returned names while preserving private/global Git
   settings, SSH configuration and the unchanged parent environment.
5. Execute `docs/plans/workspace-detached-hook-native-qa.md` with actual native
   child-process imports, preserving its foreign repository isolation checks.
   For this independent QA, allow the same bounded startup allowance for setup
   Git commands. The planner's own native query deadline remains unchanged.

The unit controls use synthetic native callbacks and Git environment names,
including an unknown future local name, to verify policy and error propagation
without launching native processes.
