# Publication nonrepresentable feature errors

Five original cases reproduced the matrix's writer feature classification
mismatches before implementation (`matrix-publication-red.log`). Attributed
publication containers cannot be preserved in the affected writer profiles;
JSON cannot serialize the separate document language field. These are feature
rejections, rather than absent implementation gates.

LaTeX, RST and RTF writer feature rejection, JSON document-field projection and
PPTX's unsupported block branch now use `E_UNSUPPORTED_FEATURE`. PPTX dependency,
reference/geometry and resource gates retain their previous classifications.
Warnings and loss transformations remain unchanged. Existing tests retain their
strict rejection assertions with the corrected error code.

Maintained checks: 970/970 package tests, package lint/typechecks and selected
workspace build pass. Logs: `matrix-publication-test.log`,
`matrix-publication-lint.log`, `matrix-publication-build.log`.
