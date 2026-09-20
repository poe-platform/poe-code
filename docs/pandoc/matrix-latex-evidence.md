# LaTeX terminal newline regression

Seven owned prose-reader-to-LaTeX rows produced two terminal newlines, violating
the contract's one-terminal-newline text policy. Two original regression tests
failed before the fix (`matrix-latex-red.log`). The second preserves paragraph
separators and both trailing source code-line breaks in their escaped LaTeX
representation; the fix removes only final serialization LF separators.

The final writer output is bounded and charged before return. No reader content,
links, IDs, spans, list order or diagnostics are normalized by the comparator.

Maintained verification: 965/965 package tests and package lint/typechecks pass;
selected workspace build passes. Logs: `matrix-latex-test.log`,
`matrix-latex-lint.log`, `matrix-latex-build.log`.
