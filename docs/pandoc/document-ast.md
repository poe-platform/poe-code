# Original TypeScript AST contract

`packages/pandoc/src/ast-types.ts` defines the exhaustive constructor unions;
`normalizeDocument(unknown, limits)` validates runtime data and returns owned data.
This is a Pandoc-style model, not a claim of Pandoc JSON wire compatibility.
Enumerations inside tuples are strings. Optional properties must be absent or
valid, never undefined. Null short captions mean absent; empty arrays mean empty.
Metadata is tagged, including maps, lists, booleans, strings, blocks and inlines.
When merging inputs, later present language/direction fields replace earlier
values with W_METADATA_CONFLICT diagnostics. Absent fields preserve earlier values.
Maps follow JavaScript own enumerable key order; attribute key/value pairs are
ordered arrays and retain duplicate keys. IDs in attributes and link targets carry
cross-reference identities. No page geometry is part of this model.

Normalization invariant: identical constructor structure, field presence, text,
list nesting and attribute order. No whitespace trimming, text coalescing,
formatting flattening or empty-node removal. Plain/Para and SoftBreak/LineBreak
remain distinct. Math contains a typed inline/display source string. Writers must
explicitly declare `math: "source"` to receive documents containing math; otherwise
writing fails with E_CAPABILITY before the writer or output capability runs.
There is no implicit math loss path.

SourcePosition and LossDiagnostic are sidecar types. They are not accepted as
extra document/node fields. Resources retain the existing explicit byte-resource
boundary; they are not JSON AST constructors. All constructor data is validated
JSON; resources alone admit Uint8Array byte buffers.

Default normalization ceilings: depth 128, 100,000 visited values, 32 Mi UTF-16
text units (including object keys), 100,000 attribute components, 100,000 covered table cells, 64 MiB
resource bytes. Node accounting includes JSON containers and scalar values.
Preflight charges text, attribute components, span areas and resources before
cloning or table occupancy allocation. Modern tables preserve caption, column
specifications, head, multiple bodies (including row-head columns and intermediate
heads), foot, row/cell attributes, alignment and spans. Spans cannot overlap or
escape their section/column count. Ragged rows are retained without padding.

Dangerous object keys, accessors, cycles, unknown constructors, invalid tuple or
union shapes, lone Unicode surrogates, nonfinite values and invalid spans fail
with paths. Shared acyclic subtrees are permitted and count per occurrence.
Readers cannot bypass validation by returning undocumented constructor shapes.
`assertNever` and exhaustive schema records make new constructors require explicit
consumer handling. Real format reader/writer conformance is separate work.

Original tests first failed on the absent normalization module; later targeted
failures reproduced out-of-section spans, column overflow, unsupported math and
resource cloning budgets before implementation. Verification is recorded in the
owned plan after maintained checks complete.
