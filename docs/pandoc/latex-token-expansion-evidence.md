# Token expansion verification

Original failing tests in latex-token-expansion-red.log reproduce parameter and
comment control-word merging and substitution inside verbatim. A second failing
case (latex-token-raw-red.log) exposes merged command names when an expanded
unsupported environment is preserved as raw source. The math interpolation case
in latex-math-interpolation-red.log reproduces a forbidden primitive assembled by
parameter interpolation. No upstream test bodies or fixtures were copied.

Expansion now substitutes parsed token lists outside math, preserves verbatim
tokens, retains exact environment wrappers, and inserts empty groups when raw
serialization needs to separate command names from following letters. Interpolated
math is parsed again before AST output; forbidden primitives and malformed
delimiters fail under every loss policy. Ordinary math commands remain typed source.
The existing cancellation test caught a bulk-admission regression during the
rewrite; incremental cooperative admission fixes it without changing that test.

Maintained checks pass: npm test --workspace=@poe-code/pandoc (47 files, 1049 tests),
npm run lint --workspace=@poe-code/pandoc (ESLint and both source/test typechecks),
and npm run build:workspaces -- --workspace=@poe-code/pandoc (declared build closure).
Logs use the latex-token-expansion prefix. Unit tests use original inline source
and existing memfs/injected capabilities, without host scratch files or external
executables, downloaded fixtures or LLMs.

Ad hoc built-command QA used memfs inputs and the repository terminal renderer.
The inspected latex-token-expansion-command.png shows successful included Unicode
expansion, raw source preservation, and empty stdout for built-in replacement,
forbidden interpolated math and missing includes. The procedure is recorded in
docs/plans/pandoc-latex-reader.md. No QA script was added.

The bounded profile and strict/raw/lossy ledger are updated. Full TeX compatibility
is not claimed. Unrelated changes remain excluded. Local delivery only.
