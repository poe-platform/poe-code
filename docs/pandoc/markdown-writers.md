# Markdown writer contract and scoped evidence

CommonMark and GFM now bind the original shared TypeScript writer in packages/pandoc.
Conversion has no filesystem, network, LLM or external-executable dependency. The
opt-in safe-bash byte adapter uses the same SDK options and conversion engine.

## Supported behavior

Paragraphs, plain list content, headings, rules, blockquotes, decimal ordered lists
(period or one-parenthesis delimiters), bullet lists, code, emphasis/strong, links
and images are serialized as Markdown. GFM additionally supports declared task
marker spans, strikeout and rectangular pipe tables. Existing table geometry and
strict/lossy span/section policies remain; rich supported table inlines now retain
formatting. Complex cell blocks and cell line boundaries retain diagnosed lossy
text projections. CommonMark rejects tables, including under lossy; strikeout and
task state require explicit lossy projection. Disabled pipe_tables rejects tables
including under lossy. Unsupported attributes/features reject by default; lossy
formatting projection is diagnosed. Notes and unsupported complex block kinds have
no Markdown syntax in this initial profile and require diagnosed omission under
lossy. Math remains rejected by the engine. No complete Pandoc writer claim.

SDK `wrap: "none"` and CLI `--wrap=none` (or `--wrap none`) are supported, default
none. Other values and columns are rejected until specified and verified. There
is no prose reflow. SoftBreak emits LF; LineBreak emits backslash plus LF. Literal
inline text line boundaries use entities; code blocks normalize CR/CRLF to LF.
Nonempty output ends in LF; an existing final break supplies that LF without
adding a second terminator; an empty document emits the empty string. Fenced code
necessarily terminates its last content line before the closing fence, even if
its AST string did not end in LF. This canonical addition is intentional.

## Intentional canonical choices

- ATX headings, backtick fences longer than every contained run, minimal code-span
  backtick delimiters with padding when needed.
- Boundary spaces use numeric entities; delimiter punctuation is protected from
  accidental syntax. GFM prose URLs/domains/emails remain prose.
- Emphasis alternates delimiters where needed for nesting or adjacency; intraword
  nesting uses asterisk delimiters. Lists indent continuation lines to their marker
  content column; list looseness comes from Para versus Plain blocks. Adjacent
  bullet lists alternate markers to preserve separate list structures.
- Targets use angle destinations and quoted escaped titles. Repeated identical
  destination/title pairs use full numeric references in first-appearance order;
  display text is never a reference identity. Distinct equal labels do not collide.
- Pipe rows use fixed spacing and three-dash alignment separators, without native
  column-width padding. Pipes inside code spans are escaped for the GFM table lexer.

These are semantic/canonical choices, not native byte-for-byte parity. Reader
parse-back URI destinations percent-encode unsafe characters, as the established
reader contract requires. Str/Space segmentation is compared as text only in the
explicit plain-text cases; formatting, list/task/table structure and breaks are
otherwise compared directly.

## Behavior inventory and test provenance

Research checkout source commit c9a9a5eed7185783b69043e019c067370dc09615,
recorded in upstream-cases.json: reviewed test/Tests/Writers/Markdown.hs, including
list with tight sublist, emph/strong boundary spaces, reference repetition and
shortcut collisions. Numeric full references intentionally avoid shortcut ambiguity.
Footnote placement and native wrapping profiles are outside this initial profile.
Tables inventory: test/Tests/Old.hs tables/pipe-tables entries, existing Tables
extension inventory in upstream-cases.json, shared table decomposition cases and
src/Text/Pandoc/Writers/Markdown/Table.hs pipe-table behavior (alignment, headerless
projection, no wrapping). No upstream test bodies or fixture strings were imported.
Original strings and ASTs are independent oracles; parse-back supplements them.

The initial seven original writer tests all failed before implementation. Later
original tests reproduced adjacent emphasis, quote blank-line, split ordered-marker
and GFM bare-domain/email failures before their fixes. One supplementary table test
initially had a malformed declaration; that parse error is not behavioral evidence.
Unit tests have no host mutations, downloaded fixtures, LLM calls or subprocesses.
Worst-case escape expansion and indentation capacity are bounded before allocation;
intermediate retained bytes are charged. Conservative bounds may reject a document
whose eventual escaped result would fit the output ceiling.

## Maintained verification

Final scope routes: `npm test --workspace=@poe-code/pandoc`,
`npm run lint --workspace=@poe-code/pandoc` (ESLint plus source/test typechecks),
`npm run build:workspaces -- --workspace=@poe-code/pandoc`.
Results and manual screenshot inspection are recorded after execution below.
No repository-wide gate, remote delivery or release is claimed.

Final maintained package run: **569 tests passed in 17 files**, including 17
original Markdown writer tests and eight adapter tests. Package lint/typechecks
and the selected @poe-code/pandoc workspace build passed. `git diff --check` passed.

Manual QA used the maintained `npm run screenshot --` route with an inline Node
command importing the built package and exercising the actual byte adapter. Viewed
markdown-command.png: CommonMark outputs heading/nested list and preserved breaks
with a diagnosed lossy task projection; GFM retains the checked task, nested list,
breaks and strike table; wrap auto exits 2 with E_OPTION and no converted document.
Rows, diagnostics and exit status are legible. The root visual CLI was not changed.
This screenshot is adhoc evidence, not a screenshot unit test or native comparison.
