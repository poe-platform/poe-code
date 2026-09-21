# Current BIFF writer verification

The existing three distinct exporters were preserved and repaired: oversized page breaks now follow native caps; page-break axes use native opcodes; version-specific rotation, accounting underlines and bold flags are correct; product replay preserves those styles; extent warnings follow native first-warning behavior. Every runtime repair followed failing regression or native differential evidence. Full requested Gnumeric parity remains **incomplete**.

The [receipt](biff-write-current-verification.json) identifies the exact candidate and captured Gnumeric 1.12.61 dependency/plugin/locale profile. Primary source was independently authenticated against the requested SHA-256 and remains only in `out`. Native ssconvert remains a QA oracle, with no product dependency or fallback.

Fresh final checks pass: 4,362 ssconvert workspace tests, package lint/runtime/test types, 18 uncached dependency-closure builds and 52 safe-bash integration cases. Ten native reopen cells succeed; both DSF streams and CFB integrity are independently checked. Six row/column warning comparisons match native. The complete workspace rerun with one worker passes after a concurrent numerical test timed out; the original failed run remains recorded. Help and diagnostic screenshots were inspected.

Explicit recalculation matches the measured native values, caches, styles, merges and page breaks. Without it, five missing formula caches differ in the manual-calculation fixture. Charts/non-comment objects, rich text, external-workbook links and the receipt's remaining mismatch groups are unsupported or unverified. No full-parity or unavailable-runtime pass is claimed.

[QA procedure and detailed coverage](../plans/xls-biff-write-current-qa.md). No README edits, commits, pushes or publication.
