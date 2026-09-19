# sql2csv independent Safe Bash stress QA

Use a worker distinct from the implementation owner. Root retains product,
integration inventory, exports and Git ownership. Canonical checks use memory
only; reference programs are not permitted in canonical unit tests.

1. Read root and `packages/safe-bash/AGENTS.md`; inspect executable grammar,
   database contracts and existing lifecycle tests without editing them.
2. Exercise the actual Shell registration with an injected in-memory database
   provider. Compare exact stdout, stderr, status, query invocations and owned
   resource cleanup. Reject explicit begin/commit and non-row iterator acquisition.
3. Check duplicate and empty labels under every `-H`/`-l` combination, including
   `line_number` appearing on the first data row when headers are suppressed.
4. Check query precedence over missing FILE/stdin, repeated engine/execution
   options, full-file newline decoding and a single unsplit SQL invocation.
5. Check binary/null/bool/large-integer cell serialization, missing-file failure
   after connect, and omitted ordinary-CSV flags rejected before connect.
6. Run the new stress file together with maintained SQL lifecycle review tests;
   cancellation must await cooperative row return and cleanup failure must still
   release the session. Report defects to root; do not broaden source ownership.
7. Ask root to register the literal new test path in the maintained integration
   input assertion, then include it in the root-selected uncached maintained checks.
8. Record measured results and limits in `docs/csvkit/sql2csv-stress-validation.md`.
   Do not claim native profile parity, real-driver DML effects, release or full
   workspace gates from this focused memory suite.
9. After root qualifies first-statement AUTOCOMMIT, independently exercise actual
   WASM SQLite with memfs: unsupported levels remain explicit status-78 blockers;
   changing isolation after a prior query must block before DML; explicit BEGIN
   still rolls back; integrity failure must leave earlier autocommitted effects
   intact and release resources. Check actual-Shell option forwarding separately.
