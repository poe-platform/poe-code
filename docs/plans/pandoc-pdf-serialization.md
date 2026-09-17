# Bounded PDF serialization

## Current task revalidation (2026-09-16)

The requested engine and wiring already exist in the current checkout. Preserve
them and unrelated work; validate gaps with original failing tests.

- Reproduced malformed object counts reaching enumeration: NaN, negative and
  fractional identity counts bypassed the pre-enumeration admission check.
  Original in-memory regression precedes the fix; require safe, nonnegative,
  bounded counts before enumeration. Red/green logs: docs/pandoc.
- Current maintained gates pass: 49 PDF tests, 1,063 Pandoc tests, both package
  lint/typechecks, selected Pandoc build closure. No new full-repository unit
  result is claimed; the historical limitation below remains historical.
- Refresh pinned independent parser/renderer QA against all current readers,
  including PPTX. Keep evidence in docs/pandoc and procedure in docs/plans.
- Local commits only; no push or release authorized.

Own serialization in packages/pdf using pinned pdf-lib 1.17.1 object primitives;
keep conversion in packages/pandoc and the existing safe-bash adapter thin.
Preserve unrelated changes; local atomic commits on main only.

## Implemented and verified

1. Original failing object tests preceded checked serialization: exact minimal
   objects, xref offsets, stream lengths, references and pre-allocation budgets.
   Reject dangling/sparse identities, unsafe counts/sizes, nonfinite numbers and
   direct cycles. Validate budgets before resource buffers and metadata admission.
2. Deterministic Unicode metadata without implicit clock fields; flat outlines
   linked to real page identities; UTF-16BE hex strings preserve URI delimiters
   and backslashes. Explicit untagged/non-conformance capability guarantees.
3. Static noninterlaced 8-bit PNG with bounded inflation, CRC/chunk/filter checks,
   RGB colors and gray alpha masks; 8-bit gray/RGB and Adobe CMYK JPEG admission.
   Pako 3.0.1 pinned. TrueType glyf supported; reject CFF/compressed font programs
   before fontkit. Emit admitted scalar glyph codes/metrics without font shaping;
   reject conflicting emitted Unicode aliases. Batch compatible text runs to
   eliminate independently observed per-glyph extraction line breaks.
4. SDK descriptive metadata and heading outlines use the same PDF engine/options
   and awaited sink. --yes permits .pdf target inference; external --pdf-engine
   commands are rejected before acquisition. Original representable cases cover
   every available reader (10); unit mutations use memfs, no host scratch,
   subprocess, LLM or downloaded fixture.
5. Maintained PDF/Pandoc package tests and lint/typechecks pass (45/912 tests).
   Selected @poe-code/pandoc build closure passes (PDF, office-package, Pandoc).
   Repository-wide lint passes. Independent pypdf 6.0.0 and PyMuPDF 1.26.4 /
   MuPDF 1.26.7 QA verifies objects, text, fonts, links, images, outlines and all ten
   reader pairs. Viewed all four rendered page screenshots. Procedure:
   pandoc-pdf-serialization-qa.md. Original inputs/results/artifacts: docs/pandoc.

## Remaining validation limitation

Full npm test reported a toolcraft-design demo failure because
`docs/plans/archive/cli-aliasing.md` is missing; the remaining run was stopped
following that failure. Repository-wide unit validation is incomplete. Preserve
scope: do not restore/create unrelated files or alter unrelated tests.

## Delivery and guarantees

Verified atomic local commits only; no push or release. Scoped implementation
and explicit QA complete. Output is untagged; no PDF/A, PDF/UA or universal
searchability/extraction/reading-order guarantees. Different engines need not
emit identical bytes; native Pandoc alone cannot validate this serializer.
