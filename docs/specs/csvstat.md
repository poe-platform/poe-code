# Literal csvstat 2.2.0

The implementation is `packages/csvkit/src/commands/csvstat.ts`, dispatched by
the domain engine and existing explicit safe-bash csvkit plugin. CLI argv and SDK
destination settings execute the same operation. The executable remains csvstat;
the family retains the fourteen released executable names.

## Source and capabilities

Source is csvkit/utilities/csvstat.py from released csvkit 2.2.0, archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
The frozen reference is CPython 3.14.2, Agate 1.14.2, Babel 2.18.0 and SQLAlchemy
2.0.54 with docs/csvkit/requirements-cpython-3.14.2.txt and the C/UTC environment
in docs/csvkit/csvstat-reference.json. Source utility and lock hashes accompany
the observations. Drivers retain the existing reference profile; csvstat never
acquires database/network/interactive capabilities.

Product code is TypeScript ESM without subprocesses or native csvkit fallback.
Input filesystem, codecs, streams, process locale, clock and cooperative cleanup
are explicitly injected. The formatter receives the Decimal spelling, injected
`locale.profile`, percent format, and grouping boolean. This process formatting
locale is distinct from `-L`, which controls Agate input inference. A host must
qualify its formatter against its chosen CPython locale profile. Reference unit
tests inject exact captured locale.format_string observations, not native programs.

## Arguments and precedence

Local flags: --csv, --json, -i/--indent, -n/--names, -c/--columns,
--type, --nulls, --non-nulls, --unique, --min, --max, --sum, --mean, --median,
--stdev, --len, --max-precision, --freq, --freq-count, --count, --decimal-format,
-G/--no-grouping-separator, -y/--snifflimit and -I/--no-inference.

Inherited flags: FILE, -d/--delimiter, -t/--tabs, -q/--quotechar, -u/--quoting,
-b/--no-doublequote, -p/--escapechar, -z/--maxfieldsize, -e/--encoding, -L/--locale,
-S/--skipinitialspace, --blanks, --null-value, --date-format, --datetime-format,
--no-leading-zeroes, -H/--no-header-row, -K/--skip-lines, -v/--verbose,
-l/--linenumbers, --add-bom, --zero and -V/--version; argparse supplies -h/--help.
The existing source-derived grammar remains unchanged; an independent exact flag
assertion checks omissions, collisions and -i meaning indent rather than another
executable's ignore-case meaning. No other executable's flags are added.

Help/version follow parser precedence. Names returns before terminal admission,
operation conflicts, selection or inference; names honors --zero and requires
headers. Otherwise terminal admission precedes conflicts. More than one operation
fails first, then operation plus CSV, JSON or count fails in that order. Count
wins both serializers and ignores selections/inference/sniffing. It counts raw
reader records, including blank/ragged records, and subtracts a header even when
the input is empty: -1 with headers, 0 without. Typed reports instead use the
Agate-compatible loader, including normalized headers and padded missing values.

CSV wins JSON when both are supplied, but JSON's presence still disables Decimal
formatting during calculation. Inherited line numbers do not add a table column
or serializer column here. Column selectors use the existing source-compatible
indices/names/ranges; --zero changes selection interpretation. Detailed/scalar
multi-column labels and CSV/JSON column_id stay one-based regardless of --zero.

## Operations and applicability

| Operation | Permitted type | Result |
| --- | --- | --- |
| type | All six | Boolean, Number, Text, Date, DateTime or TimeDelta |
| nulls | All six | Whether any null exists |
| nonnulls | All six | Number of non-null values |
| unique | All six | Distinct values, including null |
| min/max | Number, Date, DateTime, TimeDelta | Non-null extrema |
| sum | Number, TimeDelta | Non-null sum |
| mean | Number, TimeDelta | Non-null mean |
| median | Number | Index 50 of Agate's complete CDF percentile calculation |
| stdev | Number | Sample standard deviation, divisor n-1 |
| len | Text | Maximum Unicode codepoint length |
| maxprecision | Number | Agate normalized Decimal precision calculation |
| freq | All six | Frequent value/count entries |

The first reference matrix tests all thirteen operations on all six types.
Nulls are excluded from aggregations and included in distinct/frequency results.
Empty or all-null inferred columns are Boolean by default; -I makes them Text.
Text maximum length is Decimal zero when empty. Empty valid sums are zero;
empty means/extrema/medians are absent. Singleton stdev is absent. Inapplicable
operations and trapped calculations return None in scalar output and are omitted
from detailed/JSON output. Decimal NaN ordering traps suppress extrema/median,
while sum/mean/stdev can retain NaN. Host failures, work/output/retention limits
and cancellation stay observable; explicit unqualified capabilities are not
swallowed by the source's calculation-failure behavior.

Median computes all 101 source percentiles before selecting index 50. A trap
at another percentile suppresses the median too: three negative and two positive
infinities yield None, although the central input is negative infinity. Quantile
ranks retain the source's binary64 rank calculation; values and boundary-pair
averages use Decimal arithmetic. The internal metrics module also provides
ordered sample variance and preserves Python power's preferred zero exponent.

Decimal arithmetic uses precision 28, half-even rounding, and an integer-based
correctly rounded square root. TimeDelta sums check every intermediate timedelta
range and means round fractional microseconds half-even. Decimal maxprecision
ignores values whose float conversion is nonfinite (including finite Decimals
above the float range), normalizes trailing zeroes and clamps decimal places
to 28 minus the greatest whole-part width, including the source's negative result
for sufficiently large whole values.

Decimal squaring follows the frozen CPython integer-power implementation:
half-even rounding at working precision 31 followed by final precision 28.
This differs from multiplication's single rounding. All five originally captured
square discrepancies and their symmetric-pair variances now match exactly;
the original observations remain in csvstat-metrics-review-reference.json.
Independent final QA compared 5,009 admitted square inputs exactly. This measured
sample does not establish all-input compatibility outside the admitted domain;
the existing Decimal exponent budget remains an explicit limit.

Frequencies preserve first occurrence for equal-count ties. Equal Decimal values
share a bucket while retaining the first spelling/exponent and signed-zero
representation. NaNs remain distinct. Aware datetimes compare by instant; naive
and aware values are distinct. Default frequency count is 5; explicit zero also
uses 5, negatives produce an empty list, and positive values limit the list.

## Output

Single selected-column operations produce a scalar line. Multiple selections
produce `%3i. name: value` lines. Inapplicable results spell None, booleans spell
True/False. Scalar frequencies use `{ "value": count, ... }` with source's literal
string interpolation rather than JSON escaping; an empty frequency is `{  }`.

Detailed output uses `%3i. "name"`, a blank line, tab-indented operation labels
aligned to the widest label, an additional separating space, and a blank line
between columns. True nulls adds `(excluded from calculations)`, len adds
`characters`, and frequencies use `value (countx)` with aligned continuation
lines. Total typed `Row count: n` terminates the report.

Finite Decimal aggregation output and detailed Number frequencies call the host
formatter with default %.3f and grouping enabled unless -G. The formatted result
then unconditionally strips trailing zeroes and periods. Thus %.0f formatted 50
prints 5, formatted 0 can print an empty string, and a comma decimal separator
can remain after trimming. Integer counts, unique/maxprecision values and raw
scalar/CSV frequencies bypass this Decimal formatting. Nonfinite values bypass
it as well. JSON disables it entirely.

CSV has all fifteen columns in order: column_id, column_name, type, nulls,
nonnulls, unique, min, max, sum, mean, median, stdev, len, maxprecision, freq.
Unavailable metrics have blank cells; freq joins raw values with comma-space and
omits counts. JSON emits a list of ordered objects, starts with column_id and
column_name, omits unavailable metrics, and emits freq objects with value/count.
Decimal JSON values become floats, integer metrics remain integers, Date and
DateTime use ISO strings, and TimeDelta uses float total seconds. JSON has no
trailing newline; default spacing and negative/zero/positive indent behavior
match the shared CPython-compatible emitter, without JavaScript's indent-10 cap.

All writes await the existing sink and enforce invocation budgets. Cleanup is
registered before acquisition, is idempotent, and preserves caller stream
ownership and original abort reasons. Remaining shared inference/quoting/locale,
warning provenance and traceback gaps are explicit blockers; the captured cases
do not establish all-input or full-suite compatibility.
