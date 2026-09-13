# new.target grammar QA

1. Execute the independent failing regression before changing source; retain the
   initial lint-probe failure separately from the corrected semantic counterexample.
2. After repair, run the selected new-target, class/modifier, escaped-keyword and
   bound-constructor snapshot tests, scoped lint and maintained workspace build.
3. Run original pinned escaped-target and recorded escaped-new control in both
   Script modes, adding direct call/new and ASI controls affected by this grammar.
   Independently compare original file hashes and variants to the full V4 manifest.
4. Use the built SDK on available runtimes to check malformed source before marker
   writes, literal new.target through bound constructors and captured arrows,
   direct eval, finally, saved source and three pending/completed replay cycles.
   Probe ambient process/require denial and step-budget rejection.
5. Run built CLI on invalid.ajs, compare location to SDK diagnostics, render the
   actual terminal PNG and inspect it. Keep missing exact cells and unpublished
   artifacts unverified; no focused pass substitutes for full task acceptance.
