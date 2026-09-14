# Logical text extraction evidence

The bounded utility read operation is `text.get`, available as `docx text INPUT`
or `docx text get INPUT`. The exported SDK entry is
`extractDocumentText(bytes, context, options?)`; an opened location document also
provides synchronous `text(options?)`. Both use the common text.get options and
same domain traversal. No editing or document-model API completion is claimed.

## Ordering and separators

Body is the default scope. Explicit scopes are body, headers, footers, footnotes,
endnotes, comments, text-boxes and all-stories. All-stories uses that order.
Headers/footers follow section order, then default/first/even variant; shared
definitions appear once. Notes/comments follow canonical part-name order and
numeric definition ID. Normal zero-ID notes are included; separator and
continuation definitions are excluded. Text boxes follow owning-story order and
recursive XML encounter order, including supported legacy/modern shape wrappers.
Their text is not repeated in the enclosing story. Text boxes inherit enclosing
revision visibility. No story is ordered by its page position.

Paragraphs join with LF, physical table cells with TAB, table rows with LF and
stories with two LFs. Nested tables remain in block order within their cell.
Empty paragraphs/cells retain their structural separators; no terminator is
added after the final block. Authored tabs use TAB, line breaks LF, page breaks
FF and column breaks VT. Cached rendered-page-break markers contribute nothing.
Merged/omitted grid positions do not manufacture repeated or empty cell text.

Final view excludes deletions/move-from content; original excludes
insertions/move-to content; all emits both in XML order with revision kinds on
segments, without labels in plain text. Revised paragraph marks and rows follow
the same visibility policy. Field instructions never enter text, including
nested complex instructions spanning paragraphs. Only stored field results are
read. Fields are never evaluated, fetched or recalculated. Drawing and equation
content contributes no invented representation; actual text-box stories remain
explicitly selectable.

## Structured result and JS/security mapping

`TextData` retains `text`, `view`, and `segments`. Additive fields are
`hiddenText: "include"`, segment `kind`, and segment `formatting`. Concatenating
segment text reproduces the plain text exactly, including structural separators.
Each segment has an existing fingerprinted owning run/block/story location.
Locations remain resolvable and generation-bound. They are not new editable
ranges across fields/revisions. Existing admitted scalar-range tokens may narrow
plain paragraph/run text.

Hidden text is always included as logical content. `formatting.hidden` reports
the direct `vanish` property: true, explicit false, or null when absent. It does
not claim to resolve inherited style visibility. Bold, italic and RTL have the
same three-state direct mapping. Run style, language and font attributes, plus
paragraph style and bidi, provide source formatting context. They are not
computed font metrics or a style cascade. The later
[revision read milestone](../plans/docx-revision-read-views.md) adds original-view
rollback for supported direct run/paragraph snapshots, `originalFormatting` in
all view, segment/top-level revision metadata and explicit opaque warnings.
That bounded milestone supersedes the earlier absence of property-history reads.

Strings retain logical Unicode order, including combining characters, Arabic,
Hebrew, CJK and supplementary characters. There is no normalization or visual
reshaping. Existing location ranges count Unicode scalars; JS string length
remains UTF-16 length. Positions in CLI selectors remain one-based; no model
collection indexing behavior changes. Missing options use body/final; invalid
values, unknown options and accessors fail common schema validation.

Byte admission is always async and owns Uint8Array input. Limits and cancellation
are explicit, including aggregate work, retained bytes, segments and serialized
output. The API acquires no ambient filesystem, clock, font, network or executable
authority. CLI file/stdin input uses only supplied capabilities; stdout contains
text or one version-1 JSON envelope, diagnostics go to stderr, reads affect zero
objects, and failures retain the shared exit categories.

The public model inventory remains planned. Neutral model spellings and prior
documentation-error dispositions are unchanged. Utility extraction is broader
than individual model text getters in its explicit story and review selection;
it is not evidence that those getters/setters, inherited APIs, enums, collections
or underscore-prefixed documented types are implemented. Typed batch execution
and dedicated link/control/revision/shape/field/bookmark selectors remain pending.

## Evidence

Original regressions are in `packages/docx/src/text.test.ts` and
`text-command.test.ts`, with memfs fixtures in `tests/fixtures/text.ts`.
Existing location, dialect, schema, discovery and safe-bash registration tests
remain in the maintained checks. No downloaded material or substantial derived
implementation is included. Execution results belong to the
[owned task record](../plans/docx-logical-text-extraction.md).
