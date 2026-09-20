# HTML reader validation

Original AST tests were authored before implementation. The first maintained
pandoc package test run reported seven new failures (E_CAPABILITY for html) and
468 existing passes. Subsequent failing-first coverage reproduced lost formatted
and paragraph attributes, event-attribute retention, and pre/code merge loss.
Those cases pass after the implementation. A final failing test reproduced
prototype-key element names entering the inline style map; explicit own-key
lookup now unwraps them as unsupported elements.

Consulted Tests.Readers.HTML from the existing research checkout at
`/tmp/poe-pandoc-investigation-20260912/test/Tests/Readers/HTML.hs` and its inventory
in upstream-cases.json. Reviewed base handling, anchors/images, lang/xml:lang,
main, inline code and pre/code attribute cases. All local inputs and expected AST
are original; no GPL test bodies or fixture text were imported. Base URL handling,
main filtering, exact pre newlines and data-* naming differ by declared policy.
The existing parser's recovery/portability gaps were evaluated using
html-parser-probes.md before consulting its parser source; no existing command
behavior was modified or reused as a conversion shortcut.

Eleven HTML unit cases validate complete original expected AST independently of any
Markdown writer: quoted >, duplicate/case-folded attributes, legal semicolonless
entities, attribute ambiguity, numeric-invalid entities, Windows-1252 mapping,
inline whitespace, NBSP, pre/code newlines, misnested formatting, omitted end
tags, non-void self-closing and void elements, raw script closing boundaries,
figures, captions, malformed table foster parenting, sections and cell spans.
Additional checks exercise invalid UTF-8, resource denial with an always-throwing
resolver, byte-boundary invariance, cancellation, and depth/text/attribute/entity/
table-cell limits. Unit tests use only in-memory input and expectations; there
are no filesystem mutations, downloaded fixtures, LLM calls or external programs.

Verification: 479 maintained package unit tests pass; package ESLint and source/
test TypeScript checks pass; selected maintained pandoc workspace build succeeds.
Viewed html-formats.png, generated through repository screenshot tooling calling
the existing thin adapter against the built public package: complete readable
input/output lists with html as an available input and json as the available
output. This is adapter QA, not a claim that full shell conversion wiring exists.

Delivery is local only. No push, remote-main verification or release authorized.
