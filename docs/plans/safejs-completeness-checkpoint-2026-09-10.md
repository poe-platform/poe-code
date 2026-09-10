# SafeJS completeness checkpoint

The four-day JavaScript completeness objective remains active and unproven.
This checkpoint supersedes older delivery and live-process descriptions only
for the concrete evidence below; it is not an exhaustive gap inventory.

## Local implementation

- `8d69852dd`: retained-callback names are unique and selectable without changing
  workload or limits; all 21 tests and scoped lint passed.
- `d24dedde1`: disposed host journals reject pending provider/callback waits,
  prevent new reconciliation and late settlement, and detach inert provider
  reactions from SafeJS async-local state. Five main regressions failed before
  the repair. Combined integration passed 34 tests, scoped lint, 23 maintained
  workspace builds and five fresh native ESM import checks.
- `eab68faf7`: imported settled Promises preserve their recorded scheduling
  identities across host-result replay. Fresh focused qualification passed all
  42 tests; scoped lint and the maintained build passed. Malformed scheduling
  identities and graph/header disagreement remain rejected.

These are local commits, not verified remote-main delivery or publication.
Releases and pushes remain held. The three staged Safe-Bash files were preserved.

## Host-runtime locale control

All 30 unchanged tests across iso-month-name-completeness.test.ts,
temporal-plain-month-day-locale.test.ts and
temporal-plain-year-month-locale.test.ts passed with Node 26.8.1 (a73aa4).
This covers all five month widths, three locales, range-part sources, fixed
offsets, calendar compatibility, option ordering and captured-method replay.

Command used the existing isolated binary explicitly:

```sh
/Users/kjopek/.npm/_npx/a5b58b28f5a1e3b2/node_modules/node/bin/node node_modules/vitest/vitest.mjs run packages/safe-js/src/interp/globals/iso-month-name-completeness.test.ts packages/safe-js/src/interp/globals/temporal-plain-month-day-locale.test.ts packages/safe-js/src/interp/globals/temporal-plain-year-month-locale.test.ts --maxWorkers=1 --reporter=verbose
```

The default Node runtime and project engine range were not changed. This does
not fix the twelve failures recorded on Node 22.23.2, or establish compatibility
with every supported Node runtime. Do not substitute Gregorian formatting or
weaken the locale expectations to conceal missing ISO data. See the direct
native-runtime controls in safejs-temporal-plain-month-day.md.

## Remaining verification and implementation

The last full package gate remains non-green: 28,712 passed, 21 failed and
47 skipped across 1,274 files. It preceded the disposal integration. The failing
groups are twelve locale cases, two native-Promise property imports, one
128-draw replay, one camera batch, three generator-intrinsic cases and two CLI
filesystem cases. Narrow later passes do not erase that result.

- The latest unchanged camera check still failed one of eleven tests at 5000ms.
  Keep complete numerical assertions and budgets; investigate runtime cost.
- All 28 unchanged CLI filesystem tests passed in the focused recheck. The
  full-gate timeout and following exit-code failure remain unexplained; no
  filesystem repair is validated by that passing rerun.
- Native-Promise own-property admission needs a safe policy for user descriptors
  without exposing host async-hook metadata. Do not import arbitrary symbols.
- Pending imported-Promise checkpoint support remains an isolated prototype,
  not delivered runtime support. Its lifecycle code must incorporate the newer
  disposal repair before further integration qualification.
- Continue the wider JavaScript/Temporal semantic audit. Names being present,
  focused tests passing, or a package building do not prove completeness.

No full-goal completion, successful full-package gate or issue closure is claimed.
