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

Final local code checks: 20 original writer cases, 841 package tests, lint and
selected build passed. Added explicit list tab stops after a failing control
expectation and covered invalid font declarations, merged/nested table rejection
and excess list depth. Code is implemented; external picture/table acceptance
is still incomplete. No push or release is authorized.

## External application QA procedure

1. Build the selected pandoc workspace using its maintained route.
2. Load docs/pandoc/rtf-writer-application.json in an adhoc SDK invocation,
   reconstruct each resource byte array as Uint8Array and write the entire
   document with to=rtf into docs/pandoc/rtf-writer-application.rtf. Do not use
   the local RTF reader to generate expected results or to qualify output.
3. Run `textutil -convert txt -stdout` on that file for independent text
   inspection. Check escaped braces/backslash, café, emoji, Hebrew, labels 3)
   and 4), bullet and continuation, cell strings and final paragraph.
4. Run `qlmanage -t -s 1400 -o docs/pandoc` on the RTF and inspect the produced
   image. This lane is incomplete for pictures/tables: macOS omits pict data,
   flattens cells and shows tight list-marker spacing. Do not count those
   behaviors as successful interoperability.
5. Independently open the RTF in LibreOffice Writer. The attempted headless lane
   is `soffice --headless --convert-to pdf --outdir docs/pandoc` with the RTF
   operand. If launching succeeds, render/export the resulting PDF for visual
   inspection; keep the PDF and screenshot under docs/pandoc.
6. Verify heading size, nested bold/italic and normal resets, super/sub, bidi
   ordering, red/default runs, hyperlink target, numbered and nested list
   indentation, simultaneous two-column/two-row table layout, and both colored
   PNG/JPEG gradient pictures. Check the final paragraph resets to plain.
7. Exercise the SDK with invalid picture/object/font resource data and a low
   output/expansion budget. Confirm no output publication on rejection.
8. Fix any writer issue only after adding a failing independently authored test;
   rerun maintained scoped checks. Update evidence and acceptance status in
   docs/pandoc/rtf-writer.md. Do not certify the full lane until step 6 succeeds.

Observed blocker: TextEdit Apple events/interactive Quick Look did not produce
a window. LibreOffice's headless import and version requests stalled at dyld
startup, despite spctl accepting its Developer ID. No PDF was obtained. The
Quick Look screenshot is independent rendering evidence with explicit gaps,
not full external application acceptance. No security controls were changed.
