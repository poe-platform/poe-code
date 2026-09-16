# GFM reader implementation and QA

Scope: original TypeScript reader in packages/pandoc, using the CommonMark parser
and existing thin safe-bash inspection adapter. No native runtime fallback.
Preserve unrelated edits to pandoc-typescript-safe-bash.md. No README additions.

1. Pin GFM 0.29 (2019-04-06), compare actual Pandoc 3.8.3 extension flags and
   representative ASTs in a separate manual differential lane.
2. Write original failing tree tests for tables, strikeout, tasks, bare links,
   HTML filtering, independent disabled syntax, and descriptor validation.
3. Extend CommonMark parsing with explicit selected extensions; retain task
   state using documented standard AST attributes. Reject undeclared extensions.
4. Run maintained pandoc test, lint/typecheck, selected build, CommonMark
   conformance, and manual differential comparisons. Evidence: docs/pandoc.
5. Validate inspection rendering visually. Review and stage only owned files,
   commit atomic verified work on main. No push or release authorized.

Unit tests use strings and in-memory trees only; no filesystem, LLM, downloads,
fixtures or executable invocations. Manual QA reference executables are never
imported by production or unit tests and are removed after evidence capture.

Status: implementation and verification complete for the declared bounded
profile. No claim of complete GFM or Pandoc dialect equivalence.

Verified: 468 maintained pandoc workspace unit tests (41 original GFM cases),
workspace ESLint and source/test typechecks, selected workspace build closure,
and 652/652 pinned CommonMark examples. Manual differential QA classified all
51 original inputs against actual Pandoc 3.8.3; exact flags, specification pin,
AST task contract, behavior differences and viewed adapter screenshot are under
docs/pandoc. Temporary reference downloads were removed. Final stage/commit
includes only task-owned files; unrelated plan edits stay outside the commit.
Local delivery only; no push, remote verification or release authorized.
