# csvkit 2.2.0 table selector contract

Source: authenticated PyPI archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`,
`csvkit/cli.py:480–588`, `utilities/csvjoin.py:88`, and
`utilities/csvjson.py:168–183`. Runtime profile: frozen CPython 3.14.2,
Unicode 16.0.0, Agate 1.14.2 and associated dependencies in
`reference-profile.json`. These entries are source-derived regressions, not
new differential captures or a claim of complete suite compatibility.

* H01: default headers use alphabetic carry: a…z, aa…az, ba…zz, aaa.
* S01: `str.isdigit()` names are positional even if an exact header exists.
  Exact non-digit names win before `int()`: signed, whitespace-padded and
  underscore-containing integer strings can be literal headers. Duplicate
  names select the first match. Quotes are literal characters, not a selector
  escape syntax; `"1"` matches only a header containing those quotes.
* S02: comma splitting preserves order and repetition without trimming.
  An exact range-shaped header wins before range parsing. Colon takes priority
  over hyphen; integer ranges are inclusive; reversed ranges are empty.
* S03: include open starts default to 1 and open ends include ordinal N.
  With zero offset, an open end therefore attempts out-of-bounds ordinal N.
* S04: exclusion open starts also default to 1, but open ends stop before N.
  Unknown single exclusions are ignored; invalid range endpoints still fail.
  These two source branches must remain distinct.
* N01: source helper names output is `%3i: name\n`, with ordinary offset 1
  or `--zero` offset 0; `-H -n` fails with RequiredHeaderError.
* J01: csvjoin omits column_offset and ignores `--zero` for join keys.
* G01: csvjson geometry passes Boolean zero_based directly as column_offset:
  false means 0, true means 1. Geometry remains an explicit status-78 blocker;
  selector tests do not qualify GeoJSON serialization.
* D01: invalid-name diagnostics use `repr(column_names)[1:-1]`. Raw helpers
  use a list, while csvsort and csvjoin receive Agate tuples. A singleton
  tuple retains the trailing comma (`'a',`) in this diagnostic. Preserve this
  distinction without altering matching or range behavior.

Agate table naming is a separate contract: `readTextTable` currently blocks
duplicate or empty headers pending warning provenance and deduplication audit.
Raw helper first-match behavior must not be replaced with Agate deduplication.
Join-produced duplicate names likewise remain blocked. No Agate warning or
deduplication pass is claimed by this helper audit.

Separate source audit: authenticated Agate 1.14.2 archive SHA-256
`7f29841c39d84b1de7fde762b8d792085371515324f3a01413b20f810398225b`,
`agate/table/__init__.py:80` invokes `utils.deduplicate` with column_names=True.
`agate/utils.py:253–292` replaces each falsy name with letter_name(position),
emitting an unnamed-column warning. It then tries the original name followed
by `_2`, `_3`, etc. until absent from the names already emitted, and emits a
duplicate warning if renamed. It does not reserve future input names:
`a,a,a_2` becomes `a,a_2,a_2_2`; `a,,b` becomes `a,b,b_2` with an unnamed and
a duplicate warning. Warning channel/source-path fidelity remains unmeasured
for this change, so the existing blockers are retained.

Digit classification uses Unicode 16.0.0 DerivedNumericType.txt Digit ranges
plus the already pinned Decimal ranges. Numeric-but-not-digit characters can
be literal names; non-decimal digits such as superscript two cannot become
literal names and fail integer conversion. Unicode data is reference-only.
Reference URL: `https://www.unicode.org/Public/16.0.0/ucd/extracted/DerivedNumericType.txt`;
SHA-256 `786833e0a3f5ec0c0cd0940e4c15f730f3a92163f354ecd7dede28a70c0fa892`.
