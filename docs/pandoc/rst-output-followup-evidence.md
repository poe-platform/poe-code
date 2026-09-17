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
