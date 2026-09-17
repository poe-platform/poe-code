# Markdown nonrepresentable feature errors

Owned matrix probes found CommonMark table rejection and EPUB/PPTX attributed
content rejection reporting `E_CAPABILITY`, rather than the contract's
`E_UNSUPPORTED_FEATURE`. Three original regression cases reproduced the wrong
code before implementation (`matrix-markdown-red.log`). The table command case
uses memfs and asserts status 5, typed stderr, empty stdout and unchanged output.

The Markdown writer now reports feature loss/rejection separately from missing
implementation capabilities. The exported diagnostic union includes the code.
No content reduction, warning normalization or native runtime path was added.

Verification: maintained package tests 963/963 passed
(`matrix-markdown-test-verified.log`); package lint/typechecks and selected
workspace build passed (`matrix-markdown-lint-final.log`,
`matrix-markdown-build.log`). Other writers' error classifications are still
accounted for separately by the conformance lane.
