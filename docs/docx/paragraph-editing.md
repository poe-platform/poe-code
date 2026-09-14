# Paragraph editing

`editDocumentParagraphs(bytes, { operation, options, input? }, context)` and the
common CLI implement the same three bounded operations:

- `paragraphs set`: direct properties and explicit whole-text assignment.
- `paragraphs add`: append a paragraph to a story/cell, insert beside a paragraph,
  or split at a collapsed paragraph range.
- `runs add`: insert text and an optional `--break line|page|column` inline.

Normal selectors, stale tokens, output/in-place/force, dry-run, JSON, limits,
cancellation and publication rules follow the shared Office contracts. A
paragraph set with `--all` can use section/table/cell/note/comment owners to limit
its descendants; it cannot combine all with a paragraph or opaque target token.

The property options are `alignment`, `leftIndent`, `rightIndent`,
`firstLineIndent`, `spaceBefore`, `spaceAfter`, `lineSpacing`, `lineSpacingRule`,
`keepWithNext`, `keepTogether`, `widowControl`, `pageBreakBefore`, `outlineLevel`,
`tabStops`, `borders` and `shading`. Common CLI options use kebab-case. Complex
values use `--tab-stops-json`, `--borders-json` and `--shading-json`; SDK options
use the semantic names. The generated schema supplies closed object shapes and
enum symbols. Existing paragraph/character style names can be reused.

Omission leaves properties unchanged; null resets the supplied direct property.
False and zero remain explicit. Whole paragraph text assignment replaces runs
and their formatting; SDK null text clears. Direct range markers and paragraph
properties survive. It is distinct from preserving literal `text replace`.

Indentation permits negative values. Negative first-line indentation writes
hanging indentation. Before/after and physical line spacing are nonnegative;
numeric line spacing is a positive multiple. Convert once to integer EMUs with
half-away-from-zero rounding, then to twips. Both conversions must stay safe
integers. Fixed line-spacing rules write 240/360/480; MULTIPLE uses auto, EXACTLY
uses exact and AT_LEAST uses atLeast. Rule-only changes retain existing line
magnitude unless the rule has a fixed value. Conflicting simultaneous values
reject. Null line spacing removes both line and lineRule; null rule removes only
lineRule.

Tab stops replace the direct collection, ordered by rounded position. Duplicate
positions reject; negative positions are allowed; empty/null removes direct
tabs. Default alignment is LEFT and leader SPACES. Strict maps left/right to
start/end, and rejects deprecated LIST tabs. Border updates merge supplied sides,
retaining other sides and metadata. Width rounds to 2–96 eighth-points, or zero
for none; space rounds to 0–31 whole points. Shading replaces supplied direct
fill/pattern/color and removes competing theme attributes. Null borders/shading
removes that direct property. Outline level 9 is body text.

A whole paragraph anchor inserts after by default; `--before` also accepts its
token. Story/cell insertion appends before final sectPr. A collapsed paragraph
range is a Unicode scalar caret: inline insertion splits only the run; block
insertion retains prefix and suffix paragraphs around the inserted paragraph.
Both preserve mixed run formatting and suffix text. Boundary carets retain empty
paragraphs. Paragraph section properties remain only on the suffix when split.
Newlines and carriage returns in supplied text write line breaks, not paragraphs.

Nonempty insertion ranges reject. Fields, objects, links/revisions or XML
annotations that require unsupported splitting/whole-text replacement reject
before publication. Protected/shared stories retain existing guards. The output
receipt reports directly targeted objects and generation-1 paragraph locations
against the input identity; reopening output establishes a new fingerprint.

This is operation-level coverage. Live paragraph/run/tab objects, model batches,
heading/style creation, deletion, other break kinds and rendering remain pending.
No host font lookup, filesystem access or networking is implicit.
