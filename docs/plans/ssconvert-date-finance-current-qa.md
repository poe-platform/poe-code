# Current date/finance candidate QA

Preserve the existing 127-function implementation and prior reference captures.
Authenticate out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz against SHA-256
2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 before source inspection.

Execute original in-memory date-text regressions under both date systems. Check
mixed numeric separators, month/day/year ordering, the 2029/1930 cutoff, ordinary
and compact clock suffixes, fractional seconds, invalid Gregorian dates, nested
date suffixes, signed suffixes and elapsed suffixes. Validate expectations against
src/number-match.c, including got_date's allow_elapsed=FALSE call. These are
source-based checks; do not label them fresh native differential measurements.

Have a different agent inspect and stress all implemented groups. Reproduce
negative YEARFRAC basis admission and negative DATE2UNIX half-second rounding
before repairs. Include positive/fractional controls. Inspect final root parser
changes independently and minimize any newly found cases before repairs.

Run maintained uncached ssconvert unit tests, workspace lint and the safe-bash
build closure, then the registered ssconvert command integration tests. Check
command/SDK output bytes, diagnostics, serial values, date-system metadata,
checkpoint/replay, original fixture immutability and unrelated VFS names. Use
memfs/injected byte codecs; unit tests never invoke a native utility or write files.

Because shared coercion changed, also execute npm test -- --no-cache, npm run lint
and npm run build, serially after source edits settle. Do not overlap guarded
repository lint with builds that recreate workspace directories. Retain each
complete/incomplete outcome separately; a focused
pass does not replace a broad failure. Build routes must settle before final
consumer checks. Capture hashes of final candidate inputs and receipts.

Manually render the actual virtual-command output for date-text, calendar,
finance and error cases using terminal-png. Inspect the resulting image, stored
temporarily under out. Purge only this task's temporary artifacts after retaining
bounded evidence. Keep previous workers' out artifacts intact.

Native oracle access must be explicitly separate from product execution. Check
the default Docker endpoint and available named context without changing global
Docker configuration. Record unavailable fresh native measurements honestly.
Prior numeric mismatches remain open until remeasured on the final candidate.
Injected-fixture/grammar conversions are not real Gnumeric/Excel/ODF byte-codec
roundtrips; those remain unsupported without installed codecs. No README edits,
commits, pushes or publications are authorized in this QA procedure.

For a fresh oracle, build the authenticated GOffice 0.10.61 and Gnumeric 1.12.61
archives only beneath out/date-finance-current-native using the named colima
Docker context. Capture configure flags, installed dependencies, loaded plugin
hashes, locale and timezone. Missing build dependencies are setup failures;
resume only after recording and resolving them. Do not change Docker defaults.

Generate original one-column XML fixtures from the 410 previously counted cases
and 52 new date-text/basis/rounding/clock controls, split between 1900 and 1904.
Set DateConvention on the Calculation element. Recalculate the same expressions
with the shared SDK and explicit C/UTC capabilities. Use a QA-only preload shim
for time and g_get_real_time fixed at 2024-01-01T12:00:00Z; separately verify
native NOW/TODAY respond to this clock. Export native raw CSV, retain exit codes
and diagnostics, and compare every string/error exactly and every binary64 value
separately from relative tolerance. Never treat the shim or native codecs as
product dependencies or product-byte-roundtrip evidence.
