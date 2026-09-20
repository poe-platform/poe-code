# Pandoc JSON reader/writer

Implement only the JSON codec in packages/pandoc; use the declarative registry
and existing thin inspection adapter. No runtime native fallback or new shell
conversion interface.

1. Consult pandoc-types 1.23.1.2 definitions and observe pinned native JSON.
2. Write original in-memory failing tests covering every supported constructor,
   enum, metadata variant, modern table/figure structure, malformed input and
   publication prevention.
3. Implement strict JSON token validation, contextual enum translation and
   existing bounded AST validation.
4. Run maintained package tests, lint/typecheck and selected workspace build;
   record research/check evidence under docs/pandoc and commit owned files only.

QA: compare parsed native JSON with independent original cases, preserving all
array order, constructor/text/attribute/table content. Native execution is research
only; canonical unit cases never invoke it. Inspect format listing output after
JSON availability changes. Reject versions other than [1,23,1,2].

Status: complete. Original failing-first JSON tests implemented and verified;
206 package tests pass, maintained lint/typecheck and selected workspace build
pass. Native 3.11 round trips preserve observed JSON structure, and format listing
screenshot inspected. Contract and original research evidence live under
docs/pandoc. Commit locally on main; no push/release authorized.
