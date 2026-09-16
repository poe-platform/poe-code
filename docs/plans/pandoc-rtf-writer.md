# RTF writer

Implement original TypeScript conversion in packages/pandoc, registered through
the existing thin command. No native converter fallback.

1. Write independently authored failing control-structure and resource tests.
2. Implement scoped ASCII RTF with Unicode fallbacks, deterministic tables,
   paragraphs, nested lists, safe links, rectangular tables and PNG/JPEG resources.
3. Run maintained package test, lint and selected build routes.
4. Open generated output independently in TextEdit, inspect a screenshot and
   record evidence under docs/pandoc. Local reader round trips are supplemental.
5. Commit owned files on main only; do not push.

Font names are explicit reference declarations, never availability claims.
Embedded font bytes and raw active/embedded objects are outside this profile.
QA must include Unicode/bidi, scoped reset, lists, tables and pictures.

Core status: ten original cases first failed on absent capability; core writer,
registry/inspection expectations, package tests (831 cases), package lint and
selected workspace build passed. Image encoding and external application QA
remain pending; core verification is not complete task acceptance.
