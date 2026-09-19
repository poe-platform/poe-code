# JSON/NDJSON compatibility procedure

1. Replay the frozen CPython 3.14.2 dependency hash lock in an isolated reference environment under `out`. Run original CLI inputs with the frozen locale/environment; retain exact stdout, stderr and status in `docs/csvkit`.
2. Map Agate `from_json`, `from_object`, `parse_object`, and native datatype casts to original CLI shapes. Reproduce numeric/native-type gaps with failing memory-only regressions before changing code.
3. Preserve the current nested-path behavior pending resolution of the conflicting requested serialization semantics. Keep deployment-dependent warnings and unsupported resource profiles explicit blockers.
4. Run focused uncached workspace unit/build/lint checks. Independently stress the actual safe-bash registration with a different agent; root owns integration declarations and exports.
5. Verify cancellation, borrowed stream ownership, awaited writes, cleanup, codec/BOM errors, ignored common flags, and no filesystem/database effects. Remove this task's temporary reference environment and capture files after use. Do not commit or publish.
