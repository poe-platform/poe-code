# Independent GNU9.7 fraction and ISO-year source proof

Reviewer: fresh independent TIME-ENV fraction semantics thread, 2026-08-27.
Not Curie, not the prior fix verifier; no delegation. Production is read-only.

## Primary authority and measured profile

Primary sources browsed independently, with exact fetch statuses and hashes in
`primary-fetch.json`:

1. Official release: https://ftp.gnu.org/gnu/coreutils/coreutils-9.7.tar.xz
2. Official project9.7 source mirror:
   https://raw.githubusercontent.com/coreutils/coreutils/v9.7/src/date.c
3. Official project9.7 manual source:
   https://raw.githubusercontent.com/coreutils/coreutils/v9.7/doc/coreutils.texi
4. POSIX2018:
   https://pubs.opengroup.org/onlinepubs/9699919799.2018edition/functions/strftime.html
5. POSIX2024:
   https://pubs.opengroup.org/onlinepubs/9799919799/functions/strftime.html

The fresh official archive download has SHA256
`e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf`.
Five archive members match the supplied local9.7 tree byte-for-byte. The
`lib/strftime.c` member SHA256 is
`b1acd5ae751c54eb3ed11d63b4b4cdf0bf86b560b3f85534b1f7a7b497ecad54`.
The date/manual mirror bytes also match their archive members.

The actual supplied-tree executable reports GNU coreutils9.7 and has SHA256
`8d7c339a192d04e3de9768ebe4330d68bb541a4ed6c82f2bc3a807a270b156ff`.
This is NOT the author's differently located binary hash `14c1c04f...`.
The measured platform is Darwin25.4.0 arm64, libSystem1356.0.0, not GNU/Linux.
`native-profile.json` records full path, version bytes, dylibs, generated
configuration hashes, explicit LC_ALL/TZ, Node22.22.2/ICU78.2/tzdb2025c, and
`--resolution` output `0.000001000\n`. Matching source files plus matching
behavior do not establish reproducible-build provenance for the executable.

The current online GNU manual and index were attempted only as supplemental
sources; both direct requests timed out. Their supposed9.11 version is not
independently asserted. No current manual was substituted for9.7 semantics.

## Ordinary %N: source derivation

GNU9.7 `lib/strftime.c:1275` parses the flags in sequence; the last padding
flag wins. Its `N` branch at1817 defaults nonpositive/absent width to9, divides
away low digits to truncate to the requested precision, then removes trailing
zeros while retaining at least one digit. It emits the surviving digits and
uses `width_add` (`lib/strftime.c:194`) for right padding. Default/zero padding
uses zero; underscore uses spaces; dash disables padding. Numeric case flags
do not change the digits. This is not ordinary left padding.

In the accepted flag grammar, `0` itself is consumed as a flag: `%0N` and
`%00N` are nine-digit defaults, not empty zero-width fields. The new cohort
includes these spellings and ordered combinations. It also distinguishes
right padding, significant leading zeros, trailing zeros, truncation without
rounding, and negative epoch floor/remainder decomposition.

Padding zeros are not inherently fake precision. Twelve printed fractional
places can be a formatting representation of a timestamp measured only to
milliseconds; that is different from claiming a twelve-digit measurement.
The virtual policy correctly distinguishes injected-clock information from
format width. Its source preflights width and output bytes before `padEnd`;
the frozen billion-width cases confirm rejection/no-publication or bounded
unpadded output, without attempting a native billion-byte allocation.

## EXACT bare %-N is a separate date preprocessing rule

GNU9.7 `src/date.c:299` computes a decimal width from `gettime_res()`.
`src/date.c:312` scans the format before formatting and replaces the dash in
exact `%-N` with that width. Escaped `%%` is skipped; `%%%-N` therefore has
one literal percent followed by a rewritten token. `%--N`, `%0-N`, and
`%-9N` do not take this preprocessing path. `lib/gettime-res.c:39` uses
clock-resolution APIs with sampled-clock refinement; this is not an inference
from an explicit input timestamp's significant digits.

On this binary, bare `%-N` becomes `%6N`, even for `--date` explicit input.
`doc/coreutils.texi:16773` documents this special hardware-clock-resolution
assumption, separately from ordinary no-padding. This is real documented GNU
date behavior, not a Darwin libc formatter accident or a fake-precision bug.

The virtual command deliberately chooses ordinary significant-digit behavior
even for bare `%-N`. It is documented in the pinned source README. Acceptable
as a virtual-clock policy, it is NOT strict GNU9.7/Darwin compatibility:
17 of18 new strict bare-profile groups differ. The matching group is not
evidence of equivalence. The original author's11 bare mismatches remain intact.

## General %g rule: derivation, not a score-based exception

The POSIX `strftime` entries for `g/G/V` describe the ISO week-year digits and
January4/first-Thursday week1 rule. They do not specify an unambiguous signed
negative-year remainder convention. `%N` and its GNU flag behavior are not a
portable POSIX requirement. GNU9.7's own dedicated `g/G/V` implementation is
the chosen profile authority, rather than platform `strftime` delegation.

Let Y be the Gregorian calendar year, I its independently determined ISO
week-year, a=I-Y in {-1,0,1}, and t=Y-1900 (`tm_year`). C `%` here means the
signed remainder from truncating division. At `lib/strftime.c:1997`, GNU uses:

```text
r = ((t % 100) + a) % 100
g = r >= 0 ? r : (I < 0 ? -r : r + 100)
```

This exactly captures the source's sign test `t < -1900-a`. It preserves
`%G` and ISO week arithmetic; only the unsigned component presentation varies.
For negative I, the general rule is `abs(((Y-1900)%100+a)%100)`.
It is NOT unconditionally `abs(I%100)`.

For negative calendar Y, subtraction of1900 preserves the signed remainder.
If `(Y%100)+a <= 0`, taking its magnitude agrees with `abs(I%100)`.
The exceptional crossing is Y a negative multiple of100 and a=+1:
GNU's intermediate remainder is +1, but the negative next ISO year has
magnitude ending99. The source therefore emits01, not99. This derivation
applies generally, not just to a selected set of dates.

Two independently calculated/native counterexamples from the pre-frozen set:

| Gregorian date | ISO arithmetic | GNU `%G|%g|%V|%u` | `abs(I%100)` component |
|---|---|---|---|
| -0200-12-31 | ISO -199, week1, Wednesday | `-199|01|01|3\n` | 99 |
| -0100-12-31 | ISO -99, week1, Monday | `-099|01|01|1\n` | 99 |

Exact argv/bytes are `proof-804` and `proof-1204` in `native-results.jsonl`.
The first finding was promptly sent through the requested `/tmp/...progress`
file to ROOT for Curie. No source fix or new expansion followed the finding.

The independent ISO arithmetic in `cases.mjs` uses an integer Gregorian day
number relative to0001-01-01 and the Monday containing January4. It does not
call JavaScript Date, Intl, product calendar helpers, or native date to set
expected ISO years/weeks. It covers every year in a full negative400-year
cycle at four boundary/control dates, plus six year1900/2000-neighbor probes:
1624 native-only groups. All1624 match the source-branch rule and independent
ISO arithmetic;1622 match the author's simpler magnitude expression. These
are NOT1624 product passes, and the two counterexamples are NOT hidden.

For successful virtual output, calendar fields are restricted to0000..9999.
The only possible negative ISO year is -1 at the lower boundary; there Y=0,
a=-1, so the committed magnitude expression agrees with GNU. For nonnegative
ISO years, it likewise gives the unsigned last two digits. Thus the source
change is acceptable within its documented calendar domain, while the
unrestricted GNU magnitude rationale is rejected and needs correction by
its owner. Native-only negative-calendar probes do not expand product scope.
