# Fraction and ISO-year author profile, 2026-08-27

This is a new author phase after independent2542cfa. No new source here is
independently accepted. The original305/304 holdouts and historical failures
remain immutable. New expected native bytes are versioned in native-v1.json,
captured before either source change; no expected output is inferred from the
new implementation. GNU and Apple observations remain separate.

## Primary authority

Pinned GNU coreutils9.7 official archive SHA256:
`e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf`.
The locally built Darwin date binary is SHA256
`14c1c04f8a1e859e9421993856ba1d29f49dc750d91be5dd299841f970f31f44`.
The capture records archive-member hashes of src/date.c, lib/strftime.c and
doc/coreutils.texi, source hashes, runtime versions, raw status/stdout/stderr.
Native processes use explicit LC_ALL=C/TZ in task-owned temp directories; no
clock-setting call, ambient mutation, install or external service is used.

Primary pages inspected:
- https://raw.githubusercontent.com/coreutils/coreutils/v9.7/doc/coreutils.texi
- https://www.gnu.org/software/coreutils/manual/html_node/Padding-and-other-flags.html
- https://pubs.opengroup.org/onlinepubs/9699919799.2018edition/functions/strftime.html

The current online GNU manual is supplemental; the measured oracle and source
are9.7, not a claim about the latest release or every GNU/Linux platform.

## Nanoseconds

GNU9.7 lib/strftime.c:1817 trims lower-order fractional zeros after truncation
to the requested width, retains at least one digit, then right-pads if enabled.
Default/0 padding uses zeros; underscore uses spaces; dash omits padding.
Case flags have no numeric effect; the final padding flag wins. Widths beyond9
pad, never create measured precision. Leading fractional zeros remain significant.
%3N/%6N truncate, never round into the next second. Width/output admission happens
before padding allocation, including preceding UTF8 bytes and final LF.

Bare %-N requires an explicit qualification: src/date.c:312 rewrites precisely
that token based on gettime_res(), before calling the formatter. The pinned
Darwin binary rewrites it to six fractional digits, even for explicit input
with nine significant digits. Repeated flags or an explicit width take the
ordinary formatter path instead. That is a host-clock implementation profile,
not intrinsic precision of virtual input or injected clock values.

The virtual command uses the same ordinary no-padding rule consistently for
bare/repeated/width-qualified dash. It preserves significant explicit input
nanoseconds; an ordinary integer-millisecond Date.now value still has six zero
low-order digits in %N. It neither probes nor invents hardware resolution.
The twelve bare-N native-profile rows remain raw comparisons, not asserted
portable parity; %--N supplies a native ordinary-formatter control. There is
no new profile knob, time source, grammar extension or public API.

The previously unsupported eleven holdout forms have explicit widths and are
not affected by GNU's bare-token rewrite. They are now genuine capabilities.
Two old author assertions demand that %12N and %-N reject. Those assertions and
their old223/223 evidence remain unchanged; new source necessarily makes these
two historical rejection checks fail. This is an intentional capability delta,
not a runtime regression or an unchanged223/223 claim. New v1 positives replace
neither the original inputs nor their archived outputs.

## ISO year: decision before implementation

POSIX describes %g as the last two decimal digits of the ISO week-based year,
and defines week1 through the first Thursday/January4. GNU9.7 describes %g as
the corresponding year without century, like %y. Neither phrasing establishes
that Euclidean modulo100 is the required representation for negative years.

The ISO year calculation itself agrees: year0000 January1/2 belong to ISO year-1,
week52. GNU's dedicated lib/strftime.c:1997 branch, not host strftime delegation,
uses the magnitude of the remainder for a negative ISO year. Fresh GNU negative
calendar-year probes also use the magnitude for %y. Thus %G=-001 and %g=01 are
consistent digit presentations; %g=99 is an arithmetic wrap, not the last digits
of the magnitude. Preserve %G and week arithmetic; change only the unsigned
two-digit component to abs(isoYear %100). This is a general chosen-GNU-profile
compatibility rule, not a special case for January1/2, a different ISO calendar,
or a claim to mandate negative-year interpretation on every platform.

Fresh pre-change controls:30 valid input/zone groups,27 GNU matches and three
year-zero-boundary mismatches. All %G/%V values agree. Native-only negative-year
probes remain outside the command's supported0000..9999 calendar input domain;
they inform component interpretation, not an expansion of accepted grammar.
Apple results remain separately recorded; no GNU expectations are changed to
match Apple. A new versioned test will assert the native rule and neighboring
years0000/0001/0004/0099/0100/1899/1900/1999/2000/2021 across two zones.
