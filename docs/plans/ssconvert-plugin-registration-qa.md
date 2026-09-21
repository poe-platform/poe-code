# ssconvert plugin registration QA

Use the existing TypeScript ESM domain engine in `packages/ssconvert`; native
Gnumeric is a separately configured QA oracle only. Preserve existing edits,
historical seals, budgets, and guarded build/lint admission. Do not edit READMEs,
commit, push, or publish as part of this task.

1. Authenticate the official source archive retained only under `out` against
   SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Inspect the captured dependencies, plugin activation and locale environment
   in `docs/ssconvert/reference-profile.json`; retain its incomplete status.
2. Reproduce an actual Shell invocation with exact replacement exports and a
   small original memfs fixture. Require failure before repairing export leakage.
3. Reproduce missing stdin provenance in both `runCommand` and SDK conversion
   capability contexts before forwarding the optional provenance field.
4. Measure built core/plugin import time and heap in the same process. Review
   domain dependencies. Keep explicit host registration beside `agentCommands`
   when default registration would bring the domain dependency tree into the
   portable aggregate. Agent invocation remains `ssconvert`, with no new syntax.
5. Have a different agent stress and repair the implemented adapter using
   original in-memory fixtures, owned byte arguments, mocked capabilities,
   cancellation and synchronous cleanup. Register the independently authored
   test by exact path in the maintained integration discovery assertions.
6. Run maintained uncached selected workspace build closures, domain tests and
   lint, safe-bash tests/runner and guarded root ESLint. Record failed or
   incomplete gates explicitly; focused diagnostic runs supplement these gates.
7. Capture and visually inspect virtual `ssconvert --help` using the screenshot
   tool with a host-created Shell and explicit plugin, keeping artifacts in
   `out`. Confirm command and SDK status, diagnostics, ordering and namespace
   effects through their shared engine.

Record coverage and remaining mismatches in a verification document under
`docs/ssconvert`. Unmeasured native behaviors, unavailable remote adapters,
browser execution and unqualified rendering are not passes. Purge only task-owned
temporary output after recording the results; preserve pre-existing evidence.
