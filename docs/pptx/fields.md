# Cached presentation fields

`fields list|get|set|add|remove` handles inline slide-number, date, footer and
header caches. `list` is empty when no field matches; `get` requires exactly one.
Unknown field kinds remain visible with their original type: the byte SDK
returns `kind: null`, while command resource records use `kind: "unknown"`.

```sh
pptx fields add deck.pptx --slide 1 --shape Caption --kind date \
  --update explicit --text '13 September 2026' \
  --timestamp 2026-09-13T12:00:00Z --output dated.pptx
pptx fields set dated.pptx --slide 1 --shape Caption \
  --update preserve --in-place
pptx fields list dated.pptx --json
```

`preserve` is the default. It retains an existing cached string, including an
empty one, and rejects supplied text/time. Adding under preserve creates an
empty cache. `explicit` requires supplied text; dates additionally require a
valid explicit UTC timestamp. The timestamp authorizes the explicit cache policy
and is not stored in a custom extension. No date formatting, wall-clock reading,
slide renumbering or field evaluation occurs. A timestamp is invalid for a known
non-date field. Text preserves combining marks, emoji and mixed scripts exactly.

Add requires one text body and appends to its final paragraph before trailing
paragraph metadata. It creates a deterministic, part-local collision-checked ID.
It does not create header/footer placeholder shapes. Set/remove require one field
unless `--all` is explicit; zero matches require `--allow-empty`. Remove accepts
no kind/text/update/timestamp options. Shared content requires an explicit scope;
reading or editing a slide never materializes inherited fields. Local run and
paragraph font metadata, including complex-script attributes, remain unchanged.

The byte SDK exports `readFields(input, options, context)` and
`mutateFields(input, action, options, context)` with `FieldKind`, `FieldUpdate`,
and `MutateFieldsOptions`. SDK timestamps are valid `Date` values supplied by the
caller. CLI UTC strings are admitted using the shared UTC parser. SDK selection
uses the existing identity/coordinate-aware selection query; returned paragraph
and inline positions are explicitly zero-based. Callers provide byte limits,
XML limits and all I/O capabilities. Schema/capabilities expose these operations.

Command JSON reads use `data.items`: each resource has its owning location,
recognized kind (or `unknown`), field ID as nullable name, and typed `fields`
entries for `fieldType`, `cachedText`, `paragraph`, `inline`, and
`coordinateSystem`. Mutation JSON uses `effects`, `outputs`, and `fingerprint`;
dry runs report no output manifest and a null fingerprint. Errors never publish
an output. An explicit cache update for an unknown existing field returns
`unsupported-edit` (exit 1); invalid option combinations return exit 2.
