# Independent exact-environment replacement preparation

Own only this directory. Independent definitions:15 native rows +10 host rows.
No runtime-author new environment test definitions were inspected. This targets
root-approved `CommandInvokeOptions.replaceEnv` and real Shell+agentCommands,
not new syntax. Current contract and Curie's SAGAN_ENV_HANDOFF were authoritative;
the handoff's proposed-status wording is superseded by approved84fc742.

False/omitted preserves compatibility merge. True replaces the exported entry
environment with exactly options.env or {}, without ancestor exports, injected
PWD or local promotion. Cwd is independent; supplied PWD remains data. New Bash
or sh initialization may legitimately derive PWD; no empty-Bash-environment
expectation is imposed. Parent state, middleware, argv, stdin and budgets persist.

Both whole native15 cohorts use real GNU5.3 PRIMARY and /bin/bash3.2 HISTORICAL.
The env utility is separately identified Apple /usr/bin/env in both profiles,
not a claimed GNU coreutils env. The original bare nested-env recipe is unchanged;
after env -i clears PATH its system default lookup is NOT claimed to select a
profile-specific shim. A separate env-i /usr/bin/which env lookup control is
recorded. Child Bash/sh rows use explicit pinned paths: {{BASH}} renders to that
profile binary; {{SH}} to a same-binary symlink named sh. Product renders these
tokens to kernel bash/sh dispatch. No temp paths are printed or normalized.
All fixtures run in isolated directories, scrubbed env, C locale, hard8second
childgroup deadlines. Exact stdout/stderr/status and file/directory effects are
recorded. Entry order is retained raw, never normalized to manufacture parity.

Host requirements are literal frozen data in cases.mjs. They include intended
dispatch witnesses for output budgets. Cancellation can observe caller context
preservation, not inspect inaccessible shell locals after an aborted exec;
native success/failure rows cover those variable/export/function-local semantics.
No empty-variable-name validation rule beyond the approved contract is invented.

Native captures and cases must be committed before product acceptance. Preparation
red evidence on a moving runtime is not READY acceptance. Actual imported paths
are checked against pre/post hashes; unique manifests are referenced by digest
instead of duplicated per phase. Changed imported inputs invalidate a run, with
no blind retry. No source edits, skip/xfail, broad regressions, old9/custom5/BOM/jq
or expanded7 reruns; previous current-shell artifacts remain untouched.
