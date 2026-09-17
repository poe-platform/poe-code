# HTML reader

Implement original HTML input in packages/pandoc; preserve existing html-to-markdown.
Use parse5's portable tokenizer/tree builder with allocation accounting and bounded,
cooperative feeding. Validate AST directly using original tests before implementation.

Consulted existing structural probes and Tests.Readers.HTML in the research checkout:
base URLs, anchors, language, main containers, code, and pre/code attributes informed
coverage. No upstream test bodies or fixtures imported. Base and main policies differ
explicitly; full Pandoc equivalence is not claimed.

QA: run package unit tests, lint/typecheck, selected maintained build closure. Review
format-list screenshot when HTML becomes available. Record results and parser/conversion
boundaries in docs/pandoc. Commit verified task files on main without pushing.

Status: HTML implementation and scoped verification complete. Eleven original HTML
cases and all 479 package tests pass; package lint/typechecks and selected build
closure pass. Viewed the thin adapter format-list screenshot. Exact projection,
recovery, resource and bound policies plus evidence are under docs/pandoc.
Local delivery includes only task-owned files; no push or release authorized.
