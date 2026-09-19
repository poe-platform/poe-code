# Workbook millisecond rounding QA

Compare native csvkit 2.2.0 under the frozen CPython 3.14.2 profile with the JavaScript reader for exact half-millisecond cached values. Reference-only acquisition uses the hash-locked deployment and temporary inputs under `out`; canonical argv/SDK and Shell tests use immutable binary observations and memory only.

1. Authenticate the frozen executable and runtime distribution versions. Capture XLSX date/time and elapsed-duration half ties, positive and negative, through native in2csv with inference disabled. Keep cache literals intact when constructing ZIP fixtures.
2. Add exact stdout/stderr/status and side-file effect regressions before changing code. Confirm a failing original product observation; do not adjust unvalidated behavior.
3. Match the native reader's rounding separately for date/time and timedelta caches, without recalculation or displayed-text substitution. Keep XLS behavior independently measured.
4. Run maintained csvkit build/unit/lint and actual safe-bash Shell checks; independent agent stress/fix follows scoped instructions. Document any unmeasured boundaries as blockers. Inspect an ad hoc screenshot for changed CLI output.
5. Preserve unrelated edits and staging. Do not modify README, commit, push or publish. Reduce measurements into `docs/csvkit`, then purge only owned temporary evidence.
