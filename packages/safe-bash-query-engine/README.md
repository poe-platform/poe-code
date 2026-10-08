# Shared structured queries

The internal structured-query engine keeps jq and the restricted yq profile on
the same parser, decimal values, interpreter and bounded query sessions. It
preserves streaming order, cooperative cancellation and UTF-8 byte accounting
without requiring the Node.js `Buffer` global. Queries support recursive and
lexically scoped `def` filters, `test`/`match` regex queries, capture-based
`sub`/`gsub` replacements, flagged `scan`/`split`/`splits`, membership and `INDEX`
lookups, lazy `isempty`/`nth` selection, `pick` projections, repeated
`combinations`, Unicode `explode`/`implode`, whitespace `trim`/`ltrim`/`rtrim`, basic math including `fabs` and `sqrt`, `path` extraction, the jq 1.6
`leaf_paths` alias for `paths(scalars)`, and UTC
`gmtime`, `mktime`, `strftime`, and `strptime` date conversions. Date formats use
English names and POSIX format directives; `strftime` takes one format argument,
as in jq. `strflocaltime` formats timestamps or broken-down local dates in the
host timezone, including daylight-saving offsets. Zone names use the runtime’s
English timezone data. `todate` and `fromdate` alias the ISO-8601 conversions.

`env` and `$ENV` read only the environment supplied by the command context;
standalone query sessions default to an empty environment.

Use `structuredCommands` from `@poe-platform/safe-bash` and `yqCommands` from
`@poe-platform/safe-bash/commands/yq` to register commands. This private
workspace is bundled into Safe Bash and does not need a separate installation.

`trim`, `ltrim` and `rtrim` remove whitespace from both ends, the start or the
end of a string, respectively. They use ECMAScript whitespace (including Unicode
spaces and line separators), preserve interior whitespace, and reject nonstrings.

Internal import consumers can use `jsonValues` with `stream: true` and
`stringChunks: {maxControlBytes: 65536}` to receive string payloads incrementally.
String leaves emit `[path, text, final]`; other leaves and container endings keep
the normal stream format. UTF-8 sequences and escaped surrogate pairs stay intact
across chunks. Keys and numeric tokens use the explicit control-token budget.
Treat chunks as provisional until parsing succeeds, and store large payloads in
the caller's backing storage instead of collecting them in memory.
For Python-compatible imports, `profile: "python39"` admits one JSON document,
uses Python's numeric grammar (including `NaN` and infinities), rejects malformed
UTF-8, and preserves escaped lone surrogates for the consuming encoder to handle.
The byte probe recognizes UTF-8, UTF-16LE/BE and UTF-32LE/BE, with or without
a BOM. Transcoding uses bounded chunks and charges the original input bytes.
Set `stringChunks.codePoints: true` with this profile for lossless Python strings,
including raw encoded surrogates. Events add a fourth `{key, points}` field with
code-point arrays for the current object key and string chunk (otherwise `null`).
Ordinary leaves use `null` in the third field; container-ending path-only events
use `"end"`. This distinguishes raw surrogate pairs from supplementary characters
when selecting object keys or applying Python string conversions. Exact Python
decoding diagnostics remain incomplete.
With `stringChunks.containers: true`, additional `[path, bracket, "open"|"close"]`
events identify container types and boundaries without constructing their values.
Numeric values in this profile retain their original token in `Decimal.text`, so
consumers can distinguish integer IDs from floating-point IDs such as `1e0`.

`profile: "javascript"` instead matches `JSON.parse(new TextDecoder().decode(bytes))`:
one document, JavaScript numbers, replacement decoding for invalid UTF-8, and
preserved escaped lone surrogates. It charges original input bytes and parses
incrementally without retaining the entire JSON text. Returned objects, arrays
and ordinary string values remain materialized unless streamed events are used.
