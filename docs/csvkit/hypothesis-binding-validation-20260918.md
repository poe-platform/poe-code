# Hypothesis and factory-binding continuation

This continuation extends the existing fourteen-command implementation. It does
not establish full csvkit 2.2.0 compatibility or supersede unmeasured blockers
in implementation-status.md. No README additions or Git delivery are authorized.

## Validated defects and corrections

The independent agent reproduced three factory-binding failures: replacing
probeInputOpen after construction changed the admitted capability, and mutating
sniffing/column-warning options changed diagnostics. The adapter now captures
the open hook and owns optional configuration/warning data. Trusted injected
stream-provider objects retain their identity and method receivers. Exhaustive
collision preflight covers each of the fourteen literal expected names without
partial registry mutation. The new stress file is explicitly asserted in the
maintained integration-input registration tests.

The original frozen `duration long s` Shell case was converted from TODO to a
hard test and failed with status 78 instead of native `KeyError: 'ſec'`, status 1.
Direct-cast and inference regressions also failed. Agate 1.14.2's authenticated
source TypeTester.run scans physical rows/columns, eliminates failed candidates
and selects by preference only after testing all surviving hypotheses. The
engine's former first-success algorithm skipped otherwise observable errors.
Inference now keeps an independent candidate set per column; normal CastError
eliminates a hypothesis, while diagnostics/blockers propagate. No-inference,
sampling, missing-cell padding and final typed casts retain their contracts.
Direct TimeDelta casting no longer refuses Unicode units solely because an
unrelated Date hypothesis can fail.

Testing all candidates exposed previously hidden temporal-cast gaps. Scientific
numbers and standalone subday units now reject Date/DateTime normally; measured
relative day/week casts use the year-one/injected-clock sources. DateTime catches
Unicode unit lookup failures, while Date preserves their KeyError. The complete
CSV Shell sweep also reproduced a workbook regression on the serialized
interval `2 days, 3:04:05`; native TimeDelta accepts it and Date/DateTime reject it
normally. Its canonical comma form now follows those measured casts.

Frozen `de_DE` regressions also reproduced incorrect propagation of the numeric
locale into temporal casts. Native csvkit applies `--locale` to Number only;
the engine now keeps temporal configuration separate. Decimal CSV and ISO-date
JSON cases pass through both the shared engine and genuine Shell adapter.

## Reference and measured scope

The reference-only environment was created under out with hash-required
requirements-cpython-3.14.2.txt; csvkit uses the authenticated source archive
SHA-256 `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
CPython binary SHA-256 matched reference-profile.json. Agate/dbfread source
archives were separately authenticated before source inspection in memory.
No Python/native reference program participates in canonical product tests.

[hypothesis-cast-reference.json](hypothesis-cast-reference.json) records 48
direct casts and ten exact argv/stdin/stdout/stderr/status observations (eight
hypothesis cases and two numeric-locale cases).
DateTime reference objects use the explicitly declared source time
1970-01-01 00:00:00; this is a measured clock binding, not the host current date.
Domain tests assert exact cast details, native CastError classification and
exact CLI/SDK output/status using the same genuine engine. Shell tests assert
source-byte/directory preservation and registered cleanup with in-memory I/O.

Python scans sets; JavaScript scans surviving candidates in preference order.
Competing failures in one cell remain unmeasured. Full parsedatetime/strptime,
Python regex, input quoting operation modes, codecs/compression, Decimal corner
cases, guest interpreter/Agate objects and real database/service profiles retain
their existing explicit blockers. These finite observations are not parity for
those domains.

## Registration and public boundaries

Retain explicit csvkitCommands/createCsvkitCommands family registration.
Construction requires host-provided codec, locale, clock and terminal bindings.
Import review confirms the domain public graph includes workbook/XML reader
dependencies; SQLite's upstream import is type-only and runtime initialization
requires an injected engine. No startup latency benchmark or full browser-engine
qualification was performed. Automatically adding this graph and its required
bindings to default agent commands would invent ambient configuration.
Database/network/interpreter capabilities remain explicit trusted injection.

The root `poe-code/csvkit` and `poe-code/safe-bash/commands/csvkit` exports and
portable codec-only entry points remain intact. Defaults did not change, so
independent default command inventories and historical seals require no changes.
The existing package lacks README content; adding it still requires the user's
permission and was not performed.

## Checks

- Final maintained uncached csvkit unit route: 89 files, 4,196 passes, one skip
  and five TODOs; exclusions are not compatibility passes.
- Final maintained csvkit lint passed ESLint and product/test typechecks.
  Independent agent's focused stress-file ESLint also passed.
- Selected safe-bash build closure passed eleven declared builds and postbuild;
  subsequent final csvkit closures passed four declared builds, including its
  declared development dependency on safe-python.
- Maintained safe-bash runner route: 536 passes, no skips/TODOs.
- Full CSV-family direct Node selection: 2,023 passes, one validated workbook
  failure and one explicit skip, no TODOs. After the interval fix, the independent
  affected workbook/binding/temporal/locale rerun passed 69 cases without exclusions.
  This is a repaired failed cohort, not an invented final whole-family tally.
- Maintained safe-bash typecheck passed source/tests and all 26 consumer groups
  with expected negative-consumer rejection; no runtime qualification follows.
- Public package metadata: 22 passes. The previously failing selected synthetic
  committed-archive case now passes; one synthetic case is not release acceptance.
- Actual Shell diagnostics, no-inference JSON and duration table output were
  rendered with terminal-png and visually inspected; output was readable and
  unclipped. This does not establish font coverage or full CLI/browser behavior.

The initial attempt to select CSV files with SAFE_BASH_TEST_RG was incorrect:
the maintained package runner does not interpret that variable as a file filter.
Only that duplicate run's owned children were stopped. The explicit direct Node
CSV-family selection then ran to completion. Repository npm test and repository
lint were started using maintained uncached routes and interrupted after roughly
15 minutes, before the final corrections. Only their captured owned process trees
were stopped. npm test exited 1 from interruption; lint exited 130. Neither has a
completed pass/failure tally or validates the final changes. Repository-wide
acceptance remains incomplete and is never inferred from focused checks above.

Temporary owned reference environment, logs and screenshot are purged after
reduction. Other existing out evidence is preserved. No staging, commits,
pushes, publication or README additions were performed.
