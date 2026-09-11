# Make the maintained lint heap profile explicit

The qualified guarded ESLint profile uses 1 GiB of Node old space, external
600-second supervision and a 64 MiB output bound. The npm entry previously
invoked Node without an old-space flag, leaving the heap size environment-dependent.

Set `lint:eslint` to
`node --max-old-space-size=1024 scripts/lint-eslint.mjs` and update the guarded
bootstrap's exact command binding. Forwarded lint arguments, input and receipt
validation, full coverage, metadata limits and output behavior stay unchanged.
The timeout and output cap remain responsibilities of the external supervisor.
This flag bounds old space, not total V8 heap or process RSS, and does not claim
to constrain arbitrary direct Node invocations outside the maintained npm entry.

Failing-first memory tests cover acceptance of the explicit heap entry and
rejection of the former entry before configuration loading. Existing alternate
wiring rejection and all five positive fixture bindings are retained. Evidence:
`/tmp/poe-lint-heap-red.log`.

The earlier full runs observed 433.24 seconds with the explicit heap profile
and 594.13 seconds without it. They were uncontrolled observations, so this
change makes no causal performance claim. No policy, AGENTS or README change
is needed.

Validation passed all 276 maintained lint runner tests and both cases from
`npm run test:stress:lint`. Logs are `/tmp/poe-lint-heap-green.log` and
`/tmp/poe-lint-heap-stress-green.log`. A separate bounded Node flag probe reported
`heap_size_limit=1124073472`, including heap spaces beyond old space;
`/tmp/poe-lint-heap-runtime.log` records that observation.

The full maintained `npm run lint` entry passed without an environment heap
override in 374.93 seconds (`/tmp/poe-lint-heap-entry-full.log`), under external
600-second supervision and a 64 MiB output-file limit. All 10,509 configured
files were linted with zero errors/warnings and 25 receipts; root type and
workflow checks passed. This verifies the new entry, not a causal speedup.
