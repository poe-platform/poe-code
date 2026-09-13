# Debugger statement QA

1. Run the independent regression before repair; retain invalid-syntax controls.
2. Run the five focused files, scoped lint and maintained SafeJS build recorded in audit.md.
3. Replay command.json with a new report path; compare both fixture hashes and all modes.
4. Replay each argument vector in runtime-sdk.json; require replay values, host isolation and step-budget rejection.
5. Run `npx tsx scripts/screenshot.ts --output docs/plans/qualify-language-semantics/debugger/cli.png node packages/safe-js/dist/cli.js docs/plans/qualify-language-semantics/debugger/smoke.ajs`; inspect the terminal image for clear `[42,7]` success output.
6. Reconcile the atomic repair onto fetched remote main, run candidate checks and normal hooks, then verify remote ancestry and every required publication independently.
