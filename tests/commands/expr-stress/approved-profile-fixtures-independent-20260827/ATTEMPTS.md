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

All subsequent failed executable attempts must be retained in unique run
directories. Only this new independent directory is writable by this verifier.
