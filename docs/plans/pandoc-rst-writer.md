# RST writer

Implement the original TypeScript writer in packages/pandoc; register it through the existing thin adapter. No native fallback.

1. Add original failing exact-text cases for headings, inline boundaries, references, notes, blocks, lists and tables.
2. Implement a conservative RST profile, with explicit strict failures and diagnosed lossy projections for unsupported families and nesting.
3. Run package tests, lint and maintained workspace build. Execute the pinned docutils integration oracle separately from unit tests; keep evidence in docs/pandoc.
4. Commit verified task files on main, without pushing.

QA: independently inspect expected text and docutils parsed structure, including list continuation, literal punctuation, Unicode heading widths, reference resolution and long table cells. Review the AST coverage matrix for every constructor.

## Explicit integration lane

Use Python 3.9 with Unicode database 13.0.0 and docutils==0.21.2 in an isolated
integration environment. Set PANDOC_DOCUTILS_PYTHON to that environment's Python
and run `npm run test:conformance:rst --workspace=@poe-code/pandoc`. The native npm
pre-script builds the selected workspace before running the integration assertions.
The oracle consumes original strings via stdin, disables file insertion/raw
content and document-title promotion, and requires no parser diagnostics.
Never run Python or external tools from the unit lane.

QA procedure: review exact expected strings separately from the writer; inspect
parsed node counts and reference URIs; inspect a byte-adapter screenshot; check
coverage rows, strict no-publication behavior and located projections. Capture
only final evidence in docs/pandoc. `/out` was read-only in this environment, so
the temporary oracle environment was placed under docs/pandoc and must be purged.

## Completion

Implemented and registered the writer, pinned Unicode width data, documented all
core block/inline coverage rows and conservative role/image/table profiles.
Twenty original writer tests and all 753 maintained package tests pass. Package
lint/typechecks and the selected workspace build pass; 12 exact-text/docutils
integration cases pass. Byte-adapter screenshot inspected, with its CJK font
limitation recorded in evidence. Temporary oracle environment purged. Commit the
verified task as one atomic writer feature on main, without push or release.
