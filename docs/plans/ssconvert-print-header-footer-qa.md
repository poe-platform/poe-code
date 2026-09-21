# Print header/footer follow-up QA

This is a bounded follow-up to print-layout, not a workbook PDF completion gate.
Use Gnumeric 1.12.61 from the authenticated archive under out/ssconvert-lifecycle
and the separate native profile in docs/ssconvert/chart-rendering-verification.json.
Store this run's scratch in out/ssconvert-print-header-footer only.

1. Recheck archive SHA-256 and compare print-info.c with its archive member.
   Verify the separate oracle binary and DejaVu Sans hashes. Capture locale C,
   timezone UTC, importer/exporter lists and plugin/dependency profile identity.
2. Make an original single-cell workbook with a header containing mixed-case
   PAGE/PAGES/TAB, Unicode casefold variants, an unknown opcode, literal ampersands
   and an unterminated opcode. Give paper and margins explicit values. Convert
   with the pinned native ssconvert PDF exporter, keeping exit status and stdout/
   stderr bytes separate. Use task-local HOME/XDG roots and captured library/schema
   paths. Native is never called by unit tests or by the product.
3. Inspect PDF text and its rendered first-page image. Compare the expanded
   strings with the pure TypeScript helper using the same page/sheet metadata.
   Text matching alone is not a glyph/font/layout/image match. There is currently
   no product workbook painter; record the paired image gate as unsupported.
4. Verify independent negative controls, callback cancellation with falsey
   reasons, UTF-8 output limits, input work limits, malformed tokens and callback
   failures. Use memory-only tests and explicit metadata. No ambient date, locale,
   font discovery, filesystem or native utility is permitted in the helper.
5. A separate agent stresses and fixes the helper. Root owns public exports,
   integration, documentation and Git. Run the fresh selected maintained build,
   package tests and package lint after stress fixes. Record exact candidate source
   hashes; changes invalidate the earlier candidate's gate. Do not claim command
   or SDK PDF coverage, checkpoint/replay coverage or codec preservation from this
   helper gate. Do not push/publish or edit READMEs.

Required open gates remain those in ssconvert-print-layout-qa.md, including the
workbook painter, licensed font metrics/shaping, sheet admission/print areas,
codec settings interoperability and command/SDK PDF serialization.
