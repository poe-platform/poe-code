# Decimal user-edge QA

1. Read root and safe-bash instructions, preserve staging and unrelated edits,
   and assign independent Shell numeric stress to a different agent.
2. Authenticate the recorded CPython 3.14.2 executable hash. Inspect its Decimal
   context and measure infinity division and string-construction edge cases.
3. Add failing in-memory regressions before fixing each reproduced mismatch.
   Check Unicode digits, Python whitespace, underscores, signed zero, special
   payload admission and host-supplied Number digit budgets.
4. Compare 2,000 deterministic finite operand pairs under seed 20260918, with
   coefficient widths 1–64 digits and exponents -80 through 80. Compare exact
   add, multiply and divide text or trap names against compiled product methods.
   Keep native programs outside canonical unit tests; use no float tolerances.
5. Run maintained csvkit tests/lint and selected workspace build closure, then
   independent Shell regressions and focused ESLint. Check actual public imports.
6. Render and inspect compiled Shell numeric output and the payload-budget
   diagnostic. Record measured scope in docs/csvkit and purge owned out evidence.
   Keep unsupported metrics, locale, JSON and driver cases explicit blockers.
