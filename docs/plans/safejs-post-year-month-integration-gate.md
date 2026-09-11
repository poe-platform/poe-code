# Post-year-month integration gate

## Maintained build

`npm run build:workspaces -- --workspace=@poe-code/safe-js` completed with exit 0
(a77b5c) on the default Node 22.23.2 runtime. The maintained dependency closure
executed 23 workspace builds. All five SafeJS fresh-process native ESM checks
passed, including SDK/snapshot and replay-data initialization without preloads.
This build includes the local public month-day/year-month implementation and
the isolated Intl year-month admission commit d81013c50.

## Package test run

`npm test --workspace=@poe-code/safe-js` started in session 26401 (90b139).
This is the declared pretest/fs-contract/unit route, without scoped exclusions.
It completed with exit 1 (fc98aa). Default Node 22.23.2 was deliberately
retained, so the known ICU ISO-month failures were not hidden by selecting a
patched runtime.
All 100 filesystem type contracts passed in the four maintained resolution/
environment combinations (172ba2). Unit results: 27,188 passed, nine failed,
41 skipped, 27,238 total; 1,160 passing files, four failing files and two skipped
files, 1,166 total. Duration: 1,372.72 seconds.

The named failures are:

- namespace-identity-mc-002-validation.test.ts: the map-registry three-completed-
  replays case exceeded the five-second timeout.
- promise-import-properties.test.ts: both string-descriptor and user-symbol
  native Promise property imports are absent.
- temporal-plain-month-day-locale.test.ts: all three UTC/Honolulu/+05:30 cases
  produce a missing ISO month name.
- temporal-plain-year-month-locale.test.ts: the three equivalent cases fail the
  native expected-value check because the ISO month name is absent.

These are unresolved failures, not pre-existing exemptions. A focused unchanged
replay-case rerun in session 79747 passed both object/map cases unchanged
(babd29): two passed, 16 filtered out, 5.61 seconds aggregate test time and
12.60 seconds overall. This is not a timing repair. The earlier gate's other timeout failures did not recur in this
run, which does not independently prove that all timing problems were fixed.

Pre-run fingerprint (9c0a3d): 1,564 regular files recursively under
packages/safe-js/src, test and scripts, plus the package manifest, tsconfig and
root package-lock.json. Paths are lexicographically sorted; SHA-256 receives
each path, NUL, bytes, NUL. Node v22.23.2; digest:
`bb31af1b549a043704838fc3cef67a85f943dbea4757e1bc310616d82dc53087`.

The post-run fingerprint (f36f19) matches exactly. Implementation/test sources
remained unchanged during execution. This does not cover all external
dependencies or establish full JS conformance.

Output chunks and the live process handle are retained in the tool session.
This file records evidence, not a process-liveness oracle: poll the actual
handle before waiting, restarting, or calling the run terminal.

## Remaining work and delivery

The prior completed full gate failed; it is documented separately in
safejs-post-zoned-integration-gate.md. Native Promise own-property policy,
runtime locale portability, Temporal.Now, broader semantic qualification and
the substantial uncommitted integration remain open. Binding/method presence
must not be substituted for behavioral completeness. Release hold remains in
effect; no push, publication or issue closure follows from this local gate.
