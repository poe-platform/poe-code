# CSV grep set difference user QA

1. Authenticate the frozen CPython 3.14.2 executable against the stdlib re
   reference profile. Manually compile `[a-b--c]`, `[a-b--]`, `[^a-b--c]`
   with captured warnings, and `[--a]` as a warning-free control.
2. Reproduce suppression with the focused domain regression before changing
   code. Refuse the warning-producing patterns using the existing explicit
   unsupported diagnostic policy; do not claim native warning parity.
3. Run focused regex/csvgrep tests, maintained csvkit workspace tests/lint,
   and the selected workspace build closure without a task cache.
4. Execute actual safe-bash `csvgrep -c 1 -r '[a-b--c]'` with in-memory CSV
   input. Compare exact stdout/stderr/status with the explicit blocker.
   Execute `[--a]` and a valid range/literal-hyphen control to confirm behavior.
5. Root performs terminal screenshot review of the actual warning blocker.
   Keep temporary captures in out and remove owned evidence after review.
