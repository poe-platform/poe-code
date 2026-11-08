# wkhtmltopdf independent qualification procedure

This is manual QA, executed by an agent. Test runner output, native output and
screenshots go in task-owned `/out/compatibility-wkhtmltopdf`, then are purged
after durable findings are recorded. Unit tests never execute these controls,
read corpus files from the host or fetch assets.

## Admission

Record HEAD, dirty candidate file hashes, platform, architecture, Node/npm,
renderer/profile revision, binary SHA256, full native version/build output,
Qt revision and patch configuration. Native source target is
`024b2b2bb459dd904d15b911d04c6df4ff2c9031` (archived 2022). An arbitrary
installed wkhtmltopdf does not qualify this pin. Execute patched-Qt and
unpatched variants separately; unpatched single-object output cannot prove
multiple-object/TOC/header/link support. Never download or run a fallback from
product code. Admit comparator tooling explicitly as manual QA only.

Pin independent browser version and print settings separately. Its modern CSS
behavior is a second control, not the definition of legacy WebKit behavior.
Pin a PDF structural inspector and rasterizer independently of the candidate
writer. Record available Node, browser and workerd consumer cells; do not count
missing runtimes as passes. Check installed safe-bash JS and strict NodeNext
declarations in an isolated consumer without private workspaces. Inspect the
packed import/type/asset closure for unpublished names and ambient authority.

## Corpus and profiles

Use the exact ten UTF-8 files in
`packages/safe-bash-command-wkhtmltopdf/fixtures/qualification`; byte sizes and
SHA256 pins are in `docs/qa/wkhtmltopdf-qualification.md`. Do not regenerate
expected results from the candidate.

Baseline: A4 Portrait, 96 DPI, 10mm explicit margins, copies 1, screen media,
static JavaScript-disabled HTML, explicit locale/clock. Pin exact Arial regular,
bold and italic font bytes and every fallback font before evaluating typography.
If Arial is unavailable, declare a separate substituted-font profile for all
three engines; do not call that native-default qualification. The corpus embeds
one PNG; `missing.png` is intentionally absent. Deny ambient files and network.
Repeat declared images/background/print-media/smart-shrink profiles separately.
Native processes run only in an isolated comparator environment with explicit
fixtures/fonts and denied outbound network; never use the host filesystem as
the candidate VFS or run negative-authority markup with ambient permissions.

## Execute and inspect

1. Render long-table, typography, images, page-breaks and links individually
   through native, browser and candidate CLI/SDK. Preserve literal argv, stdout,
   stderr, status, input/output hashes, VFS before/after inventory and resource
   usage. Observe missing-image diagnostics rather than assuming their status.
2. Render cover + outline-toc + furniture with a TOC through patched native and
   candidate. Browser controls cover/body independently; browser has no native
   wkhtmltopdf TOC cell. Test text furniture and HTML header/footer files as
   distinct profiles; pin explicit clock/locale for substituted date/time.
3. Rasterize every PDF page at a declared resolution. Inspect screenshots side
   by side for repeated table heads, split rows, wrapping, baselines, glyphs,
   image dimensions, page breaks, TOC text/destinations, margins and furniture.
   Record page-specific differences with image references. No visual receipt
   means no layout fidelity claim, even when text or page counts agree.
4. Separately inspect xref/trailer/page trees, page dimensions, outlines,
   destinations and annotation rectangles. Check multiline link rectangles
   against rendered text and target-page coordinates. Include absent fragments,
   percent encoding, duplicate inputs and selector-like fragments. Do not infer
   correct link geometry from an apparently valid PDF or visible link text.
5. Run negative-authority HTML only under denied comparator capabilities and
   memory VFS candidate inputs. Check no fetch/script/ambient-file effects.
   Test cancellation during acquisition/render/output, idempotent cleanup,
   destination rollback, symlink/hardlink aliases and exhausted byte/work/page/
   TOC-iteration budgets. Check original/checkpoint/replay only where supported;
   otherwise record unavailable cells explicitly.
6. Keep all 122 source switches in the admission/rejection matrix, including
   their scopes and arities. Use independent literal controls for misplaced
   globals, duplicates/order, covers, binary32 values, mixed margin units,
   grouped shorts, `--key=value`, `--`/`--0`, tokenizer quirks, and distinct
   single-job 401/404/network statuses versus batch 0/1. Source-derived checks
   remain separate from executed native evidence. Distinguish physical pages,
   counted numbering and outline prefixes across collated/uncollated copies.
7. Minimize each discrepancy, preserve any seed, add a fast memory-only failing
   regression before a repair, then repeat the affected control. Run maintained
   scoped lint/test/build gates; shared repairs require full repository gates.

Measure performance in a separate run with explicit input sizes, budgets,
runtime, warmup and samples. Timing does not prove semantics. Report passes,
failures, skips, unsupported cases and incomplete runs separately; leave every
missing native/browser/font/runtime cell unverified.
