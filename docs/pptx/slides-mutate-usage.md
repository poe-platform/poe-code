# Slide order, names and visibility

Draft usage for the private workspace utility. The injected safe-bash command and
byte SDK support move, rename and hide/show; a live presentation object model is
not yet implemented.

```sh
pptx slides move deck.pptx --slide 4 --position 1 -o reordered.pptx
pptx slides set deck.pptx --slide 2 --hidden true --in-place
pptx slides set deck.pptx --slide 2 --hidden false --name 'Closing notes' -o shown.pptx
pptx slides move deck.pptx --selection-json '[{"kind":"slide","position":{"coordinateSystem":"one-based","value":4}},{"kind":"slide","position":{"coordinateSystem":"one-based","value":2}}]' --position 1 -o reordered.pptx
```

Move removes the selected slides, then inserts the ordered block at the requested
final one-based position, in `1..remainingSlides+1`. Selection positions resolve
against the input snapshot. Duplicate selections fail. Files are listed in
presentation order; their filenames and numeric IDs do not determine ordering.
Every slide retains its original ID, relationships and package part name.

`--slide N`, `--select TOKEN`, `--all`, or `--selection-json QUERY_OR_ARRAY` is
required. Advanced queries support exact names, IDs and explicit one/zero-based
positions. Names need not be unique; ambiguous names fail unless that query sets
`all: true`. `--name ''` clears the label. Tokens become stale after package edits.
Advanced queries cannot be mixed with simple selectors, and only slides are valid.
No notes, master or layout selection is inferred.

`--output`/`-o` or `--in-place` is required except with `--dry-run`. `--force` permits
replacement of an existing destination through the supplied publication capability.
`--output -` emits only presentation bytes. `--json` returns the common version-1
result; `schema slides move` and `schema slides set` describe inputs/results.
`--allow-empty` permits zero matching slides, but never missing update fields.
Unchanged values return the targeted count, zero effects and original archive bytes.

The package exports `mutateSlides(input, options, context): Promise<Uint8Array>`.
`input` is admitted bytes, a byte source, or a path under an explicit VFS capability.
Context supplies byte/archive/XML/relationship limits and optional cancellation.
Options are `{ selection, position?, name?, hidden?, allowEmpty? }`; `selection`
is one `SelectionQuery` or an ordered readonly array. This byte operation is always
async. CLI operation options use the same domain implementation; JSON option names
are camelCase. Null names are rejected by this operation schema; use an empty string.
No host paths, clocks, native runtime or network authority are discovered implicitly.

Moves edit only the presentation ID list; rename edits the selected common-slide
name; visibility edits the slide root's `show` flag. Existing notes, links,
animations and unrelated parts are preserved. Signed, macro-enabled, protected,
invalid and unsupported conditional presentation structures fail before publication.
This increment does not add deletion, duplication, layout/background assignment,
section editing or the separate documented live model API.
