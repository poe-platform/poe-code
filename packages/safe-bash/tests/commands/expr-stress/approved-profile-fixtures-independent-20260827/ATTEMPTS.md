# Verifier setup attempts

1. Initial read-only inspection exited 127: using `path` as a loop variable in
   zsh replaced its special PATH binding, so `cat` and `find` were unavailable.
   Repository root/status/index were printed first. No files or children were
   created. Repeating with `file` restored ordinary inspection.
2. Read-only inspection guessed `diagnostics-review/freeze/runtime-driver.mjs`
   and `qualified-final-review-20260827/replay.mjs`; both were absent. The actual
   archived driver is `diagnostics-review/runtime-driver.mjs`, and the historical
   241-test invocation is recorded in `expr-legacy241-candidate.json`. No replay
   or product mutation occurred in these locator failures.
3. A read-only final-author inspection looked for `SEAL.json`; the author uses
   `FILE-MANIFEST.json` instead. No capture or source change resulted. The actual
   manifest and final receipt were then read and independently authenticated.

The first executable replay, `run-01`, succeeded. Its expected original 240/241
failure and original runtime 11/12 failure are preserved, not setup failures.

4. `final-audit` stopped on a too-strong verifier assumption: the live temporary
   proof issue receipt no longer equaled the author's committed original copy.
   The separate proof leaf had appended its 36/47 runtime confirmation. The
   original 1,330 bytes remain an exact prefix, and both committed evidence trees
   were unchanged. Failure, exact failed driver, observed receipt and completed
   audit outputs are retained there. `final-audit-02` binds the committed proof
   run separately and records both receipt hashes plus the exact appendix;
   it does not overwrite or waive the first failure or mutate author evidence.

All subsequent failed executable attempts must be retained in unique run
directories. Only this new independent directory is writable by this verifier.
