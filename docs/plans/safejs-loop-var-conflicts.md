# Loop var binding conflicts

Native Function rejects lexical bindings that conflict with var declarations
in for-in and for-of headers, including destructured declarations and either
declaration order. Current SafeJS accepted these invalid programs.

Nine native rejection comparisons failed before the repair; eight valid
controls passed, covering repeated vars and distinct lexical/function scopes.

Register every var-bound loop identifier through the existing var declaration
scope walker, instead of treating uninitialized loop vars as lexical bindings
in the temporary loop scope. Keep let/const registration unchanged.

All 17 focused regressions passed, followed by 1,474 broader parser/runtime
tests with one skip. TypeScript and focused parser/test lint passed.
This followup is outside the currently frozen integration candidate. Publication
remains held; no local commit, push or release is claimed here.
