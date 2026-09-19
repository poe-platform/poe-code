# csvstack QA

1. Verify the csvkit 2.2.0 archive hash against the frozen profile. Inspect its
   literal utility, inherited parser overrides and Agate dictionary writer.
2. Capture exact stdout, stderr and exit status under frozen CPython 3.14.2,
   Agate 1.14.2, SQLAlchemy 2.0.54, locale C and timezone UTC. Keep observations
   in docs/csvkit; use out for temporary oracle inputs and remove them afterward.
3. Run the in-memory canonical differential tests before changing the engine.
   Confirm failing input/group `line_number` collision cases and SDK regression.
4. Implement the utility inside commands/csvstack.ts using the actual runtime.
   Recheck union order, missing/duplicate/extra cells, positional widths, grouped
   cached stdin row, repeated stdin references, filename override, physical skips
   and cross-file line numbering. Assert the literal option inventory.
5. Have an independent agent stress safe-bash registration, byte ownership,
   backpressure, cancellation and injected VFS close/reopen failure ordering.
   Ensure retained input files and partial stdout are asserted, not assumed.
6. Run maintained uncached csvkit workspace build, test and lint routes; build
   the safe-bash workspace closure and run focused safe-bash csvkit tests,
   TypeScript/lint checks and maintained test-inventory assertion.
7. Inspect an ad hoc screenshot of actual safe-bash csvstack help and collision
   output. Keep screenshots in out and purge them after inspection. Do not add
   screenshot tests or invoke host csvstack as the product command.
8. Report accepted-but-blocked quoting modes and unqualified verbose diagnostics
   separately from passing string-reader cases. Do not commit, push or publish.
