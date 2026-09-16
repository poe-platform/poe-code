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

Picture status: original in-memory PNG/JPEG data first exposed absent encoding,
then exact output-limit acceptance exposed an overly conservative estimate.
All 836 package cases, lint and selected build now pass. Independent textutil
inspection exposed missing visible legacy list markers; add original modern
list-table tests before fixing that. TextEdit/Quick Look launch events are
pending and screenshots currently show only desktop, so application visual QA
is not accepted yet.

Modern list fix: original control-table test failed first, then passed after
numbering placeholders, stable list ids and nested level references were added.
Package tests (837), lint and selected workspace build passed; independent
macOS text extraction now retains 3), bullet and 4) markers. Full visual
interoperability remains under investigation, especially cells and pictures.

Paragraph/table scope fix: an original heading/scope test failed first; explicit
heading character properties and ambient intbl at cell/row terminators now pass.
All 838 package tests, lint and selected build passed. Regenerated the entire QA
document directly from the independently authored AST (stored as JSON evidence).
LibreOffice 26.8.0 is the additional independent application lane because macOS
Quick Look omits pict images. PDF export and visual inspection remain pending.

JPEG scan extension: independently authored progressive DC/AC scans failed on
the baseline-only marker check, then passed after bounded multi-scan and restart
marker traversal was implemented. All 839 package tests, lint and selected build
passed. No native runtime converter fallback was introduced.
