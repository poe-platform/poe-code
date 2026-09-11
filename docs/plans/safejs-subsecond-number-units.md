# Portable microsecond and nanosecond units

The current ECMA-402 sanctioned-unit table includes both units and their valid
per-unit compounds. Node 22/24 support them; the existing portable NumberFormat
used on Node 18 rejects them. Seventy-two direct portable comparisons across six
locales, four simple/compound units and three widths failed before changes.

## Current implementation

- Pinned cldr-units-full 48.2.0 as a build-only development dependency. It has
  data for all 766 existing NumberFormat locales. The generator extracts only
  microsecond/nanosecond plural and per-unit patterns, preserving the Unicode
  license in generated output and leaving the source JSON unchanged.
- Parsed, shape-checked NumberFormat engine adaptation adds the two sanctioned
  identifiers. No host Intl mutation or node_modules editing.
- Supplemental-data merging has an independent failing test followed by a
  passing implementation; existing units/compound records are preserved.
- Compound comparisons exposed untrimmed denominator whitespace in the engine;
  the parsed replacement now trims the numeric-placeholder removal result.
- Sign-part comparisons exposed a separate bidirectional-mark defect, tracked
  and delivered independently in safejs-number-sign-parts.md.

The combined four-file suite passed 128 tests on Node 22 after both corrections.
This does not establish Node 18 delivery: its native integral-plural correction
in numberformat-numbering.ts still constructs unsupported unit formatters.
Validate and repair that path without losing exact BigInt plural selection.
Also verify Intl.supportedValuesOf('unit') on older Nodes, compound formatting,
range parts, snapshots, option order, and invalid units.

Before delivery, run targeted lint/tests and the maintained build plus built
Node 18/24 probes. Keep this atomic prerequisite separate from DurationFormat.
The exploratory DurationFormat dependency was removed while working on this
prerequisite; reinstall its pinned version only when its integration resumes.

## Exact-operand investigation

Node 18 built probes confirmed that integral formatting still reached native
NumberFormat and threw for microsecond. The candidate now checks native unit
support before using that word correction, retaining the portable path otherwise.

Two additional direct private-engine tests fail for the exact integer
10000000000000000001n: Russian microsecond and RUB currency-name output choose
the many form instead of one. The engine's five decimal-to-number conversions
before plural selection are now adapted to decimal text, but the tests still
fail (219 passes, two failures in the six-file run). This change alone is not a
fix: generated plural locale functions call parseFloat on integerPart, losing
precision again. Inspection across all 224 locale sources found uniform operand
initializers for n, i, f and t. Their arithmetic/comparisons need exact handling,
including modulo and fractional operands, before this prerequisite can ship.

A separate Node 18 built assertion also confirms that the guest
Intl.supportedValuesOf('unit') omits both new units. That catalogue remains to
be updated alongside the portable implementation. No candidate delivery is
claimed from the passing build alone.

## Verification update

The generator now preserves n/i/f/t as BigDecimal operands and rewrites their
comparisons, modulo and arithmetic through parsed, shape-checked expressions.
All 286 tests in the seven focused files pass, including exact Russian integers,
Arabic integer/fraction selection and Icelandic/Latvian long fractional operands.
Targeted ESLint and the maintained 23-workspace build (including four fresh
import checks) pass. Built Node 18.18 and 24.14 checks pass for exact operands
and the sorted guest unit catalogue.

Built snapshot replay and range-part concatenation checks pass for both simple
units and both tested compounds on Node 18/24. The invalid-unit probe discovered
another concrete portable defect: `nanoSecond` is accepted on Node 18, whereas
Node 24 rejects it with RangeError. Inspection locates unconditional lowercasing
inside the dependency's IsWellFormedUnitIdentifier. This requires a failing
direct-portable regression and correction; do not claim invalid-unit parity.

The unexcluded maintained SafeJS suite was started after the focused checks;
source/tests remain unchanged while it runs. No full-suite result or delivery
is claimed yet. The preceding sign-parts commit, 09830c7, is independently
confirmed published as @poe-platform/safe-js 0.1.466.

Additional built differential probes cover cardinal and ordinal selections for
24 ordinary positive/negative/integer/fractional values in every native-supported
locale from the 224-locale dataset: Node 24 passes 10,704 comparisons and Node 18
passes 10,320, with zero differences. These supplement, not replace, the exact
decimal-string/BigInt regressions and the maintained suite.

The case-sensitive unit requirement is confirmed directly by
[IsWellFormedUnitIdentifier](https://tc39.es/ecma402/#sec-iswellformedunitidentifier):
it compares the original identifier (or numerator and denominator) against the
sanctioned list, with no lowercase conversion.

Cross-version full-part comparisons pass for 288 locale/unit/width/value cases
on each of Node 18 and Node 24 with numberingSystem explicitly set to latn.
Without that option, Arabic default digits differ between the native ICU
versions; that observation is locale-data variation, not evidence of a unit
formatting defect. The mixed-case rejection mismatch persists independently.

The unchanged-source maintained suite finished in 553.61 seconds: 21,021 tests
passed, 14 failed, and 37 skipped (708 files passed, three failed, one skipped).
The failed files cover the open DurationFormat, weak-collection and host-promise
import investigations. They remain required work; this is not a full-green claim.
The mixed-case validator correction is independently scoped and will be delivered
in its own commit after the portable-unit prerequisite.
