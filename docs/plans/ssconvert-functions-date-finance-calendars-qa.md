# Dates, finance, derivatives and calendars QA

Authenticate the released 1.12.61 primary archive in out against SHA-256
2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12.
Read all five plugin descriptors; retain arities, flags, aliases and source identities
in docs/ssconvert/function-coverage.json. Retain existing captured reference profile.

Run original in-memory regressions before implementation, then the maintained
uncached ssconvert build/test/lint tasks and cross-workspace safe-bash checks.
Never launch native programs or write fixtures from unit tests. Use memfs for
file-change tests. Native ssconvert is only an isolated, separately captured QA
oracle with explicit dependency/plugin/locale/timezone identities.

Exercise serial 0/59/60/61, negative dates, both date systems, Gregorian century
boundaries, fractional times, DST and injected clocks; custom weekends, duplicates,
errors and holidays; day-count bases; coupon month ends; zero/negative rates,
multiple roots and failure cases; option sides and numerical boundaries; Hebrew
leap months and Christian movable holidays. Compare expression and date-system
metadata after Gnumeric/Excel/ODF conversions, without stringifying numbers.

After implementation a different agent independently stresses and repairs the
implemented tool using failing regressions. Root retains exports, integration and
Git ownership. Record every measured mismatch and every unsupported/unmeasured
domain; none counts as a pass. Do not push or publish, or edit README files.

For native remeasurement, use a separately isolated build of the authenticated
archive with GOFFICE 0.10.61. Capture `ssconvert --version`, binary/module/library
SHA-256 identities, dependency versions, compiler and the explicit invocation
environment from date-finance-native-profile.json. Native source/builds and
original generated fixtures belong only under out; never introduce that executable
into product code or unit tests.

Use formulas retained in docs/ssconvert/date-finance-differential.json to construct
original one-column Gnumeric XML QA fixtures with DateConvention 1900 and 1904.
Run the oracle with C locale, UTC and isolated HOME/XDG/GSettings directories:
`ssconvert --recalc -T Gnumeric_stf:stf_assistant -O 'format=raw separator=,' input.gnumeric fd://1`.
Retain exit status, raw stdout/stderr and per-formula values. Exclude bare-name
parser controls from function coverage. Treat expensive work-budget stress cases
separately; interrupted oracle runs are not passes.

Evaluate each original formula through the actual shared SDK evaluator with the
same date system, C locale and UTC, explicit budgets and an injected clock.
Compare strings/errors exactly and numeric binary64 values exactly. Separately
classify relative tolerance1e-12; never count a tolerance match as exact parity.
Volatile clock functions require separate deterministic oracle qualification.

Run `npm test --workspace=@poe-code/ssconvert -- --no-cache`,
`npm run lint --workspace=@poe-code/ssconvert`,
`npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`,
and the focused safe-bash ssconvert command tests. Inspect an ad hoc virtual-command
screenshot. Retain coverage, candidate hashes, profile and check receipts under
docs/ssconvert; purge owned temporary out artifacts and retire the owned oracle
container after measurements. Real byte-codec roundtrips must be measured separately
from grammar/injected-fixture tests when those codecs exist.
