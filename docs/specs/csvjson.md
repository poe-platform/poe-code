# csvjson 2.2.0 executable contract

The descriptor preserves the literal csvjson executable and source argparse
actions; `-i` means integer indentation, `-k` a key column name for ordinary JSON,
`-y` dialect sniff limit and `-I` disabled inference. There are no subcommands or
additional flags. The source archive and runtime identities are frozen in
docs/csvkit/reference-profile.json; original cases are in csvjson-reference.json.

Ordinary table output is an array or insertion-ordered keyed object. Values use
Agate serializers: Decimal becomes binary64 JSON float (including NaN/Infinity),
dates/datetimes use ISO strings and durations use Python timedelta text. Decimal
keys are normalized before conversion to strings; null keys become `None`.
Duplicate keys fail before stdout serialization; the key column remains present.
UTF-8 Unicode is emitted without ASCII escaping, with Python separators and no
final newline except streamed records. Integer indentation includes zero/negative
indent's newline behavior. Materialized newline output rejects any supplied indent.

Only `--stream -I -y0` with no skipped lines takes the incremental path. It requires
an injected streaming codec. Its first record supplies names even with `-H`; raw
duplicate names overwrite values without moving the first property position,
missing cells become null, extra cells are ignored and null spellings remain text.
Otherwise --stream materializes and infers the table, including header normalization.

GeoJSON requires both coordinate arguments even with explicit geometry. --key
selects feature ID; --type is excluded from properties but generated coordinates
still produce Point geometry. Coordinate/property/ID columns resolve using the
source's Boolean offset (default zero, --zero one), a deliberate compatibility
quirk. Null properties and falsey values are omitted, except a non-null ID is kept.
Decimals in properties/IDs use strings rather than ordinary JSON's floats.
Zero coordinates yield null geometry; default bbox then raises the source TypeError.
Invalid text coordinates yield null geometry; null coordinates raise TypeError.
--no-bbox suppresses collection bounds; --crs appends named CRS to collections.
Streams contain individual features and never collection bounds or CRS.

Explicit geometry preserves insertion order, integer-vs-float identity, nonfinite
tokens and arbitrary precision integers through the shared ordered JSON decoder.
Bounding-box comparisons preserve arbitrary integer precision, including mixed
integer/float comparisons, rather than rounding integer coordinates to binary64.
Numeric `ms`/`us` abbreviations are rejected by temporal hypotheses and remain
text in inferred ordinary JSON, matching the frozen parser profile.
The generator lives in packages/csvkit/src/geojson. Empty and singleton numeric
coordinate lists raise IndexError; null and scalar coordinate containers raise
the source len TypeError. Empty object/list/string geometries retain null bounds.
Boolean coordinates are numeric for comparison and remain booleans in output.
Null/bool/Decimal geometry cells reproduce json.loads TypeError diagnostics.
See docs/csvkit/geojson-compatibility-register.md for preserved native bugs.

Bounds initialize before comparing values, so a first latitude may be null,
string, list or mapping. Null bounds remain uninitialized. Subsequent strings
compare by Unicode code point; incompatible scalar comparisons raise the native
TypeError, with no JavaScript coercion. See geojson-user-edge-reference.json.

List-to-list comparisons and remaining malformed bbox schemas,
timedelta GeoJSON serialization and nonnumeric typed coordinate TypeError profiles
remain explicit status-78 blockers. Some inferred geometry cells containing null,
true or false after digits also encounter the shared parsedatetime inference
blocker; their original observations remain in geojson-inferred-user-edge-reference.json.
Exhaustive binary64 shortest-roundtrip profiles,
all schema/index/truthiness edge cases and all inherited encoding/locale/sniffer
profiles are not qualified by the finite differential cohort.
