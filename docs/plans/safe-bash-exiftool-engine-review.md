# ExifTool engine prerequisite review

Status: incomplete; prerequisite findings block engine completion. Reviewed the
current worktree on 2026-09-18. Existing contributor edits were preserved.

## Validated findings

- No `packages/safe-bash-command-exiftool` or
  `packages/safe-bash/src/commands/exiftool` exists. A path-scoped `git diff`
  contains no implementation changes to review. Engine tests, contracts,
  cancellation, accounting, cleanup and packed exports therefore remain
  unverified, rather than passing.
- The required first-party PDF parser is absent. Neither `packages/pdf-parser`
  (the proposed owner in `safe-bash-pdf-parser.md`) nor
  `packages/safe-bash-pdf-parser` exists. `packages/pdf/src/index.ts` exports
  `renderPdf`, not the accepted object/revision/metadata reader.
  `packages/pdf/package.json` declares external runtime dependencies
  `pdf-lib`, `@pdf-lib/fontkit` and `pako`; substituting this renderer would
  violate the engine's zero-external-runtime-dependency and parser-reuse
  requirements. The prerequisite plan expressly distinguishes parser and
  renderer ownership.
- No ExifTool declarative versioned tag/format registry implementation was
  found. Its requirements are documented in
  `safe-bash-exiftool-research.md`, but documentation does not supply tag
  identity, conversion, duplicate priority or independent format writability.

## Existing reusable capabilities

`packages/office-package/src/index.ts` exports bounded ZIP/compression codecs,
CRC and stream/runtime contracts. `packages/docx/src/index.ts` exports XML and
document-property inspection APIs, including `inspectDocumentProperties`.
Office primitives are present; this review does not claim they are missing or
qualify their complete suitability for ExifTool OOXML/XMP semantics.

## Remaining acceptance work

The execution rule in `safe-bash-exiftool.md` requires prerequisite acceptance
gates before dependent integration. Complete and qualify the shared PDF parser
and declarative registry before claiming this engine task complete. Reuse the
Office capabilities after checking their namespace, byte-preservation,
cancellation and budget contracts; do not duplicate their engines.

Then write original failing in-memory engine tests before implementation for
endian-aware TIFF traversal, offset cycles, unknown/raw tag preservation,
bounded XMP structures/language alternatives, container lengths and duplicate
identity/priority, PDF metadata/revisions and Office properties. Include
boundary/failure/cancellation/resource-lifetime tests and isolated packed
runtime/declaration consumers. Preserve lexical scalar provenance separately
from CLI serialization. Reader admission must not imply writer admission.

No product code, package manifests, exports, commits, pushes or publication
were performed during this review. No engine checks could be run because the
engine and its tests do not exist. This document records unresolved findings;
it does not close implementation or compatibility gates.

## Current behavior-task review update

The absence findings above describe the earlier prerequisite review, not the
current tree. A private zero-runtime-dependency command package, public facade,
bundled implementation/declarations and bounded PNG text/scalar engine now exist.
See `safe-bash-exiftool-implementation.md` for historical and current verification.

This increment adds qualified UTF-8 writes and PNG tIME inspection/assignment/
deletion after failing tests. Review reproduced and corrected packed timestamp
binary output, stored Latin-1 binary conversion, variable-width timestamp
formatting and deletion of unknown text whose keyword collides with ModifyDate.
The declarative registry derives tag names from writable chunk declarations;
reader name collisions no longer authorize deleting unrelated chunk types.
Temporal shifts are explicitly refused after a fresh native control confirmed
that timestamp -= is a shift rather than scalar removal. Cleanup and publication
continue through the existing VFS-owned implementation; no host access, runtime
dependencies, native fallback or proxy-only functions were added.

Full PDF/parser, XMP, TIFF/EXIF, Office inspection, catalog, import, scan, argfile,
protocol and native warning/no-op compatibility remain unresolved. All E01–E24
groups remain open and block completion. The current screenshot renderer also
lacks CJK/emoji glyphs; exact-byte tests verify those characters independently,
but that screenshot does not qualify their visual appearance. The previously
recorded repository-wide failed test gate is still open; focused checks are not
reported as clearing it. No publication, push or release is claimed.
