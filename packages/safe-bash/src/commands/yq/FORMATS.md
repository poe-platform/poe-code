# Mike yq format conversion

The explicit `mikeYqCommands()` plugin accepts CSV, TSV, properties, XML,
INI, TOML, base64 and URI input with `-p` / `--input-format`. These formats,
plus shell variables and Lua tables, are available through `-o` /
`--output-format`. Documented short aliases work too.

For example, `yq -p csv -o json . /records.csv` reads a header row and
returns an array of records; `yq -o csv . /records.yaml` writes a header and
records. CSV/TSV support quoted delimiters, escaped quotes and multiline fields.
Cells use YAML scalar typing. Shell and Lua are output formats only.
Base64 and URI encode string scalars; base64 decoding requires UTF-8 text,
and URI output uses form-style `+` spaces.

Conversion uses the configured virtual filesystem and existing Mike-profile
byte, document, scalar, node, depth, step and output quotas. It does not invoke
native tools. Split output uses the selected format's extension.
Properties keys are checked against configured depth and parser-node quotas
before constructing their nested maps; each new node also consumes native work.

This remains a bounded format profile: properties support simple dotted paths;
INI supports simple sections and entries; XML supports elements, repeated
children and `+@` attributes. Java properties escapes/continuations, advanced
INI dialects, XML directives/processing instructions and format-specific tuning
flags are not qualified. TOML input uses the maintained bounded TOML parser;
TOML output supports mapping tables and scalar/array entries. HCL and kyaml
remain unsupported. These codecs do not establish full native format parity.
