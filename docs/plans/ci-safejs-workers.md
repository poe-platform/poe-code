# Restore CI SafeJS test concurrency

The local SafeJS worker limit introduced while resolving #688 also changed CI from two workers to one. The previous successful release unit job (`34470602577`) took 18 minutes 8 seconds; release `34480158848` spent 1384.66 seconds in SafeJS alone, while shared unit time remained similar (259.18 versus 267.46 seconds). This is evidence of a scheduling regression worth correcting, not a controlled attribution of every elapsed second.

Keep one worker for native local SafeJS runs, where concurrent replay cases previously hit their fixed deadlines under host contention. Restore two workers when CI is set, matching the previously successful CI configuration. Other workspaces retain two workers. Preserve all test membership, isolation, assertions, five-second deadlines, native lifecycle hooks and immediate failure reporting.

Validation: evaluate local/CI configuration selection; run the complete maintained SafeJS workspace unit command with CI=true; run repository lint; push and monitor actual release validation. Record local results and measured CI results separately. No speedup claim is established until the new CI run completes.

Local validation: the actual Vite config loader selected one worker for local SafeJS and two for CI SafeJS, local root and CI root. The complete maintained `CI=true npm run test:unit --workspace @poe-code/safe-js` route passed: 736 files, 21,659 tests, 37 skipped tests, 368.40 seconds. Repository-local Git hook environment variables were cleared only for the child. This local CI-mode timing is not an actual CI timing comparison. Independent review approved the two-line configuration change.

Full repository lint passed (ESLint, TypeScript and actionlint) in 223.12 seconds. No lint speedup is attributed to this worker configuration change. Actual CI timing remains pending release validation.
