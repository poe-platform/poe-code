# Large-argument Bessel phase QA

Tracking: hey-boss #3623 within the open numerical family in #1748.

1. Authenticate Gnumeric 1.12.61 `src/sf-bessel.c` against the recorded hash.
   Read its phase dispatch, amplitude, paired reduction and warning threshold.
   Read goffice 0.10.62 `go-quad.c` and inspect the installed library's split
   multiplication, multiplication and division instructions before porting
   their rounding order. Keep source probes and binaries in ignored `out`.
2. Compile the unchanged Gnumeric phase functions with aliases to installed
   goffice and libm. Record exact inputs, values and warning occurrences for
   J/Y, zero/half/integer/negative/large orders, the 2^52 boundary, subnormal
   phase tails and square overflow. A source component is not a full native
   application or another platform's libm.
3. Run the maintained focused Bessel/numeric tests, package lint and selected
   workspace build. Preserve exact original regressions and finite work limits.
4. Exercise the compiled public SDK and `runCommand` with original in-memory
   Gnumeric XML formulas, both load-only and forced recalculation. Read exported
   XLSX caches independently of formula execution. Compare exact values and
   warning occurrences. Abort on the warning and verify no output publication.
   Replay the same compiled public exports in Node, a browser page and module
   worker, and workerd. Check original cancellation-reason identity and disposal;
   workspace artifacts do not substitute for registry-installed qualification.
5. Inspect an actual command diagnostic screenshot. Check that ordinary finite
   results and overflow errors export successfully and the input stays intact.
6. For residual native differences, inspect amplitude, phase, quadrant and
   primitive sin/cos separately. Use an independent high-precision calculation
   to distinguish source parity from mathematical accuracy; retain discrepancies
   explicitly rather than rounding them away.
   Inspect native machine instructions when source expressions admit different
   fused-product orders; qualify compiler contraction separately from libm.
7. Authenticate the full native application's binary and library hashes. Run
   the retained regressions and an explicitly recorded boundary matrix through
   `ssconvert --recalc -T Gnumeric_Excel:xlsx`. Decode its numeric/error caches
   independently and compare both public candidate routes and warning counts.
   Record the platform, enabled plugins, environment and exact cohort; missing
   historical captures do not count as replayed coverage. Isolate differing
   primitives without changing the pinned profile solely to match another libm.
8. Reduce receipts into the gap ledger, purge consumed raw captures, commit
   explicit paths, verify remote-main ancestry and monitor publication. Keep
   broader numeric/platform qualification open until its own evidence passes.
