# Keep portable unit words and patterns consistent

Built Node 18 formats German narrow hours as 1Std. after the localizer replaces
the portable h word with native Std. but keeps the portable no-space pattern.
Native Node 18 emits 1 Std.; the private engine emits 1h. This is a concrete
mixed-data defect, also relevant to DurationFormat. The earlier Persian spacing
observation has the same correction path.

An in-memory AST experiment removes the old native integral-word substitution
while leaving sign separation and digit localization intact. It restores German
1h and retains the exact Russian singular form for 10000000000000000001n. No
source files were changed while the full suite was active.

A broader 432-case comparison against native Node 24 found 18 differences, at
least some of which are native huge-integer plural selection anomalies: native
English emits singular hour for 10000000000000000001 whereas the exact portable
rule emits hours. Investigate against the underlying CLDR rule before treating
native output as authoritative. Do not restore incorrect rounding just to match
an older/native oracle.

The complete difference list confines all 18 mismatches to the exact integer
10000000000000000001 in English, German and French. The other 414 comparisons
match. Inspected CLDR rule functions require i=1 for English/German singular;
French singular requires i=0 or i=1, and its million-multiple condition also does
not match this value. This confirms the portable other category for these
cases rather than a reason to reintroduce native word substitution.

Inspection of numberformat-backend.ts confirms that modern Node versions use
native NumberFormat directly, so removing the portable localizer correction will
not by itself repair native huge-integer word selection exposed through SafeJS.
Audit that path separately with failing guest-level tests; do not broaden the
pattern-consistency commit into an unverified global backend switch.

Built guest-level probes now confirm both routes are affected: on Node 18 and
Node 24, formatting 10000000000000000001n yields singular hour and singular US
dollar (currencyDisplay name, maximumFractionDigits 0). The exact private plural
engine already supplies other. Correcting word provenance must cover both the
older word-substitution path and the modern native formatter path; decimal/code
currency formatting need not switch backend without evidence requiring it.

Three regressions failed before implementation: a simulated older ICU German
word creates 1Std., and guest unit/currency-name BigInt formatting selects
singular words. The implementation removes native word substitution and tracks
portable formatter instances, selecting portable data for unit and currency-name
styles even on modern Node. Other modern styles keep the native backend. The
five-file focused run passes 196 tests, including DurationFormat integration.

Verification: the broader 25-file Intl regression run passes 753 tests. Focused
lint and the maintained safe-js workspace build closure pass (23 workspaces and
four fresh-import checks). Built Node 18.18.0 and Node 24.14.0 each pass both
exact guest plural regressions. Each also passes 120 complete DurationFormat
part comparisons against Node 24 expectations; that integration remains a
separate, uncommitted feature. Deliver this correction independently.
