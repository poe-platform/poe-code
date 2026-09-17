# TypeScript converter: agent QA procedure

## Scope and prerequisites

Execute this Markdown procedure as an agent; do not replace it with a QA script.
Read root and applicable scoped AGENTS.md. Preserve unrelated work. Store owned
fixtures, output and evidence under docs/pandoc/qa-typescript. No push/release.
README publication requires separate explicit permission; draft only.
Use original inert fixtures. Never execute embedded scripts, macros, raw directives,
LaTeX shell escape or remote resources. External tools belong only to this QA lane.

## Execution steps

1. Inspect public exports, registry, argument parser, limits and Office gates.
   Verify default shell registration excludes pandoc. If the public CLI cannot
   enable the plugin, first reproduce with original failing CLI/SDK unit tests,
   then add explicit opt-in with SDK parity. Unit mutations must use memfs.
2. Run maintained scope checks after implementation, including normal root build
   for CLI integration; record actual failures rather than accepting partial runs.
3. Run public built SDK conversion and register the public safe-bash plugin.
   Exercise help/version, both format lists, extension listing, unknown formats,
   unsupported options, missing formats, invalid extensions and missing files.
   Check exit codes, stderr readability and clean stdout for failures.
4. Execute actual public CLI `bash --pandoc -c 'pandoc …'` with a scoped root.
   Check default exclusion, a printf pipeline, file input and command `-o` output.
   Capture `npm run screenshot-poe-code -- bash --pandoc -c 'pandoc --help'`
   and representative errors/listing/conversion; inspect every captured image.
   There is no root pandoc subcommand. No screenshot unit tests.
5. Create an original inert document with headings, code, nested lists, links,
   merged tables, images and multilingual text. Generate standalone HTML and
   inspect in an independent browser with JavaScript/network disabled.
6. Generate PDF with a long table and multiple pages. Render all pages with an
   independent PDF renderer; inspect clipping, pagination, repeated table heads,
   links, image proportions and Unicode. Record unsupported font/glyph cases.
7. Open generated EPUB in an independent reader. Inspect spine order, TOC,
   internal/external link targets without network navigation, media and reflow
   at narrow/wide sizes. Browser extraction alone is not an independent EPUB reader.
8. Open generated RTF in an independent word processor with macros disabled.
   Inspect headings, code, lists, table/image losses and Unicode.
9. Check generated LaTeX and RST with externally pinned versions, only in this
   lane. Disable raw/file insertion in Docutils; disable shell escape in TeX.
   If tooling is absent, report not run, including versions sought.
10. Query Office capabilities before testing. Open generated representative PPTX
    and DOCX independently only when enabled. Keep conversion and sibling Office
    editing evidence separate. Unavailable directions are not tested successes.
11. Reduce any validated defect to an original small failing unit regression,
    implement the narrow fix and rerun maintained affected checks.
12. Update docs/pandoc usage/limitations and package README drafts with verified
    examples, all options/limits, format/extensions, losses, source/oracle identity
    and Office gates. Do not apply README drafts without explicit permission.
13. Commit each verified atomic improvement on main, explicitly staging only
    owned nonignored files and this procedure when relevant. Record local hashes.
    No full-Pandoc, full-fidelity, release or missing-renderer success claims.

## Execution record

Results and current blockers: docs/pandoc/qa-typescript/results.md.
CLI opt-in original red/green evidence: docs/pandoc/qa-cli-{red,green}.log.
This procedure remains repeatable; completion is determined per lane by evidence.

Executed on 2026-09-16. Original CLI/SDK red tests reproduced the absent explicit
opt-in; implementation and focused green checks are complete. Normal root build
and Pandoc maintained unit/lint routes passed. Current independent visual lanes
and explicit not-run gates are recorded in results.md; this is partial QA
acceptance, not full converter/Office fidelity or repository-gate completion.
Temporary pinned external QA tools were removed after evidence collection.

Final cleaned root lint passed (zero errors, 14 warnings), including type-contract
and workflow stages. The full test route was stopped after recorded out-of-scope
failures and remains failed/incomplete. Comprehensive Pandoc and PDF README
drafts were refreshed without changing README files; the publication gate remains
open. CLI opt-in local commit: 85eb2cd48. No push or release.
