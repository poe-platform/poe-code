# RST current-code validation

Original failing unit case reproduced escaped punctuation in image alt options.
Docutils independently confirmed those backslashes became displayed alt text.
Literal option rendering retains control validation and nesting diagnostics.

Verified `npm test --workspace=@poe-code/pandoc` (1053 tests), package lint/source
and test typechecks, and the maintained `test:conformance:rst` route (selected
workspace build plus 13 docutils 0.21.2 cases with Unicode 13.0.0).
The added oracle assertion checks actual image alt values, independently of source.
The [adapter screenshot](rst-literal-alt.png) was inspected: literal punctuation
is readable and no extra escaping is emitted. Logs are rst-output-unit.log,
rst-output-lint.log and rst-output-oracle.log. No push or release.

Original failing tests also reproduced flattened quote-leading cells, footnotes,
definitions and nested quotes, and a following quote absorbed into a definition.
The fix anchors content columns with empty comments and separates the adjacent
definition/quote. Independent oracle experiments established that a same-line
comment alone is insufficient for a quote-only footnote: the comment must occur
on the indented content line. Final integration cases verify the quote structure
and top-level siblings, beyond matching output strings.

Final maintained package tests pass: 47 files, 1058 tests, including 26 writer
cases. Package lint/source/test typechecks and selected workspace build pass.
All 18 original pinned docutils integration cases parse without diagnostics.
Final logs: rst-containers-unit.log, rst-containers-lint.log and
rst-containers-oracle.log. The [container screenshot](rst-quote-containers.png)
was inspected: indentation and separating comments are visible. The first manual
screenshot input had an invalid three-element API version; corrected input uses
the maintained four-element version and adapter exit status is successful.
The isolated Python/docutils environment was removed. Python remains exclusive
to the explicit integration lane. Existing memfs publication and strict/lossy
tests pass; every core AST family has a representation or loss/error coverage row
in rst-writer.md. These checks establish the documented conservative RST profile,
not complete upstream Pandoc compatibility. Unrelated changes were preserved.
