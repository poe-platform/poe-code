# Header-only PDF table admission

The existing TypeScript PDF engine and Pandoc AST adapter cover the requested
layout profile. Audit remaining placement paths without altering unrelated work.

1. Reproduce header-only table overflow with an original in-memory failing test.
2. Admit the complete declared header group against remaining page space.
3. Run maintained PDF and Pandoc unit/lint checks and selected build closure.
4. Generate an owned two-page sample under docs/pandoc, independently render and
   inspect both pages for margins, complete text and table borders. Record evidence.
5. Commit the verified correction and plan on main; do not push or release.

Status: failing test reproduced one page instead of two. Correction verified by
48 PDF and 1,063 Pandoc tests, PDF ESLint/typechecks and the maintained Pandoc
build closure. PDFKit rendered both regression pages; both inspected without
clipping or missing text. Existing eleven owned sample PNGs also inspected.
Evidence: docs/pandoc/header-only-layout-evidence.md. Local commit only.
