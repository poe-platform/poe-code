# Final acceptance audit — 2026-09-16

**Incomplete.** The text milestone and implemented expanded formats do not
establish whole-contract acceptance. No unresolved work is archived. No README
permission, push, remote-main delivery or publication is claimed.
Procedure: [agent audit](../plans/pandoc-final-acceptance.md).

## Current public behavior

Fresh normal build and public `poe-code/pandoc` imports were used for
[literal SDK/Shell probes](final-audit-public.json). The probe initially treated
the exported `formatCapabilities` array as a function; that harness error was
corrected before capture and is not a converter defect. Public graph/type/plugin
unit checks pass 4/4: [maintained consumer check](final-audit-public-unit.log).
Pandoc maintained unit checks pass 1,043/1,043 in 46 files with no skips:
[unit run](final-audit-pandoc-unit.log). Workspace lint/typechecks pass:
[lint](final-audit-pandoc-lint.log).

Fresh public SDK/actual plugin checks of every enabled reader profile (EPUB2 and
EPUB3 separately) against eleven canonical writer names are retained in
[the public reader matrix](final-audit-reader-matrix.json). These use existing
original matrix-owned inputs through explicit QA byte reads, not downloaded unit
fixtures. A typed feature rejection remains a rejected conversion, even when its
command status agrees with SDK behavior; this is not an upstream-ID coverage run.
The 132 rows contain 111 successful conversions and 21 E_UNSUPPORTED_FEATURE
rejections, with no SDK/command success-versus-error disagreement. Probes retain
literal text/errors and byte lengths/SHA-256; redundant binary JSON dumps are purged.

| Required profile | Actual availability and evidence | Acceptance gate |
| --- | --- | --- |
| commonmark/gfm/html/json/csv/tsv readers | Built-in; original AST, delimited, JSON, normative CommonMark and selected native comparisons exist | Whole profile/ledger reconciliation remains open |
| commonmark/gfm/html5/json/plain writers | Built-in; output html aliases html5; SDK probe succeeds | Plain projection and diagnostics differ from contract; wrapping options missing |
| LaTeX read/write | Built-in; unit and selected native evidence; literal writer probe succeeds | External TeX QA not run; include and loss-policy differences need reconciliation |
| RST read/write | Built-in; docutils 0.21.2 original cases and writer evidence | Spanning-table/loss behavior and advertised columns need reconciliation |
| RTF read/write | Built-in byte reader, ASCII writer; original unit/structure evidence | Independent word processor failed to start; table preview finding unresolved |
| EPUB2/3 read, EPUB3 write | Built-in; epub3 output aliases epub; independent ZIP/XML and EPUB.js visual/link evidence | Exact native provenance differs; some nonempty strict pairs unsupported; ledger not closed |
| PDF output | Built-in private TypeScript PDF engine; searchable parsed/rendered output exists | Required serif/sans fonts unavailable; internal links and required layout/diagnostic behavior incomplete |
| DOCX read/write | No built-in adapter; returns E_CAPABILITY, status 3 | Public sibling byte APIs exist, but required inline structured note insertion is unverified/unavailable |
| PPTX read/write | Active bounded public sibling adapter; outputs W_LAYOUT_UNMEASURED | Full presentation-application/repair/notes QA incomplete; keep adapter task open |
| XLSX read | No sibling SDK; E_CAPABILITY, status 3 | Workbook reader/API and independent QA absent; keep task open |
| XLSX/PDF input, CSV/TSV/plain output, markdown/commonmark_x | Forbidden directions/deferred names reject | No successful conversions inferred from descriptors or suffixes |

All five required additions remain required. Availability and simple successful
probes are intermediate evidence; the incomplete gates above prevent completion.
See [matrix summary](matrix-summary.md) and [executed visual QA](qa-typescript/results.md)
for independent artifact/tool identities and actual findings. This audit does not
reinterpret a failed native comparison or unavailable renderer as a pass.
Existing CLI help, narrow HTML/EPUB, PDF page 2, RTF and first-slide PPTX captures
were visually reinspected during this audit. The PDF continuation starts with an
empty left cell, RTF preview stacks table cells, and slide bullets sit close to
labels, consistent with the retained findings. HTML/EPUB content remains readable
in the inspected narrow samples. These are reviews of existing captured artifacts,
not fresh application-open/repair-dialog or complete presentation qualification.

## Options and contract discrepancies

The normative contract requirements are retained. Its historical package absence
and proposed-export statements are corrected separately from the requirements.
The following reconciliation is not permission to reduce the requested scope.

| Contract/advertised option | Current concrete behavior/evidence |
| --- | --- |
| -f/--from, -t/--to | Explicit selections work; missing selections reject unless yes; registry/CLI original tests |
| --read, --write | Required contract aliases absent; actual public probe returns E_OPTION/status 2 |
| -o/--output, stdout and binary output | MemoryFileSystem atomic publication tested; actual CLI RealFileSystem rejects E_CAPABILITY before acquisition; stdout carries bytes; do not claim successful host -o |
| --yes | Explicit selections win; tested suffix/default inference and EPUB metadata defaults |
| --lossy | Tested target-specific diagnosed reductions, not every normative reduction; several lossy pairs still reject |
| -s/--standalone | Descriptor-specific admitted/rejected behavior; HTML/LaTeX wrappers and complete document writers have original tests |
| -M/--metadata | Current parser accepts KEY=VALUE or KEY:VALUE and JSON-looking values, unlike contract literal strings; title=true rejects because title becomes boolean |
| --metadata-file | JSON-only explicit capability input, typed merge/delete semantics; YAML rejects; metadata/orchestration unit cases |
| --wrap | none supported; required auto/preserve reject E_OPTION in actual public command and SDK type excludes them |
| --columns | Required contract option absent in CLI/SDK; RST descriptor/usage still lists columns; actual public command rejects E_OPTION |
| --pdf-page-size/orientation/margin/font-size/line-height | Typed SDK/CLI settings and geometry admission tested in publication-options and PDF suites |
| --pdf-font | mono bundled; serif/sans return E_CAPABILITY/status 3; admitted VFS font paths supported. Contract requires all three families and default serif |
| --pdf-page | Explicit WIDTH,HEIGHT,MARGIN, same SDK pdfPage; original font/page/geometry tests |
| --epub-title/language/identifier/chapter-level | Shared typed SDK/CLI settings, metadata/default precedence and finite chapter range tests |
| --raw-content | reject/escape/retain admission and target-specific errors; structural safety tests |
| --resource-path/--extract-media | Explicit VFS capability only, bounded acquisition/extraction and collision/traversal tests; no implicit download |
| --fail-if-warnings | Prepublication refusal is tested; current E_WARNINGS/status 2 differs from contract diagnostic vocabulary |
| --help/-h, --version | Own identity, readable usage and actual capabilities; help captured in public probe; existing inspected CLI screenshots |
| --list-input-formats/output-formats/extensions | Actual sorted available directions and GFM signs captured; combined-list and collision tests |
| --, repeated flags, unknown options/extensions | Original CLI/registry tests; format/wrap/raw/output repetition rejects; publication options use last value; metadata merges in order |
| --pdf-engine, filters, unsupported native flags | Explicit rejection, no engine/process fallback; actual public external-engine probe returns E_OPTION/status 2 |

Additional substantive discrepancies validated against current source:

- Attached `-fcommonmark -tplain` rejects E_OPTION; separate and equals forms
  work. Repeated -f rejects rather than the contract's scalar last-value-wins rule.
  [Actual CLI edge probes](final-audit-cli-edges.json) also confirm that unknown
  inferred suffixes and help mixed with conversion flags reject as required.
- The contract's entire-flag-set paragraph prohibits resource-path/extract-media
  while its later capability sections and delivered CLI support bounded explicit
  resource operations. Metadata-file, raw-content, warning refusal, supplied PDF
  fonts/page boxes, EPUB options and epub3 alias likewise exceed its frozen table.
  Internal contract/plan evolution needs reconciliation, not silent narrowing.

- DiagnosticCode has no W_LOSSY, I_PROJECTION, W_RECOVERY, E_LAYOUT,
  E_RESOURCE_DENIED or E_RESOURCE_MISSING constructors. Current typed diagnostics
  use W_TABLE_LOSS/W_PRESENTATION_LOSS/W_RAW_CONTENT, E_RESOURCE and E_CAPABILITY.
  Status mapping contains names that the engine's type does not emit. Mapping
  entries alone do not prove the contract errors are implemented.
- Strict plain output currently silently strips ordinary formatting, emits inline
  `[note: …]` rather than numbered endnotes, and has no I_PROJECTION. Literal
  prose probe returns no diagnostics. Required projection classification remains open.
- Contract specifies independently parsed inputs with namespaced IDs. Current
  CommonMark file/stdin test intentionally joins input text before parsing; registry
  defaults one joined operand, while explicit document readers concatenate ASTs.
  Do not claim references/macros always cannot cross input boundaries.
- GFM registry offers raw_html switches beyond the contract's four declared
  configurable switches. No corresponding contract acceptance follows automatically.
- Explicit bounded LaTeX VFS includes are implemented and unit-tested, whereas
  the frozen profile requires include denial and no macro expansion. Simple
  newcommand/renewcommand/providecommand expansion is implemented. RST likewise
  admits bounded explicit includes and raw directives outside its frozen profile.
  This requires a deliberate contract
  decision; do not weaken the contract during an audit to erase the difference.
- EPUB currently warns/drops CSS rather than implementing the required selector
  cascade. Its original strict test accepts missing media/CSS/overlays without
  lossy, while the contract requires strict refusal of unsupported meaningful
  features. Multiple supported rootfiles select the first with a warning, nonlinear
  entries retain spine position, and XML admits only UTF-8; the contract requires
  multiple-rootfile refusal, nonlinear reordering and declaration-aware UTF-16.
  Reader availability is not acceptance of those requirements.
- PDF visual evidence records table-row continuation and rejected internal links,
  shaping and merged cells. Contract requires between-row pagination/oversize-row
  failure, safe internal link annotations and a broader font profile. Rendered
  supported reductions do not certify those rejected requirements.

## Budgets, loss and host boundaries

Finite current execution defaults are declared in packages/pandoc/src/execution.ts
and captured in the usage draft. Original execution/resource/archive/cancellation
tests cover boundaries, chunks, producer-buffer reuse, sink failure, cooperative
yielding, cyclic inputs, malformed fonts and no successful publish after refusal.
Adversarial and capped-growth evidence is separate from ordinary unit acceptance.
The tests do not guarantee containment of an uncooperative trusted host callback.

Actual default tableCells is 100,000, parts 4,096 and expandedBytes 64 MiB;
the contract baseline says 1,000,000 cells, 10,000 entries and 128 MiB expanded.
These stricter limits must be reported, not silently called equivalent. Object
and image/glyph/resource ceilings are explicit, with per-format charges and gauges;
they are not a process-RSS guarantee. Current resource errors and lossy reductions
have the vocabulary differences recorded above. Bounds and graph tests alone do
not close the whole independent edge-case ledger.

Maintained public consumer tests inspect the built portable graph, strict types,
memfs packaged runtime, actual explicit registration/collision/replacement and
conversion. They reject native/dynamic engine imports, ambient fetch/require and
Office engine inclusion in text graphs. No conversion logic, native fallback,
network fetch, external executable or LLM was added by this audit. Independent
renderers/native oracles remain explicit historical QA lanes, not unit dependencies.

## Coverage and unresolved dependencies

upstream-cases.json contains **4,211 rows: 4,198 planned, 13 not-applicable,
0 passing**. Implemented unit counts are not mapped ledger IDs. The matrix's
4,211 not-run denominator includes disposition rows and must not be reported as
4,211 unimplemented in-scope tests. All reserved local IDs remain unimplemented
in the ledger, with source-binding checks and lexical completeness limits retained.
Some historical reasons still say no converter exists; this is stale investigation
text, not justification for marking those rows passing. Complete independent
discovery review, behavioral decomposition and ID-to-test/run mapping are pending.

DOCX gate: [verified public API and note limitation](docx-sdk-gate.md).
XLSX gate: [SDK discovery](xlsx-sdk-gate.md).
PPTX gate: [bounded conversion/independent QA](pptx-verification.md).
README gate: `packages/pandoc/README.md` and `packages/pdf/README.md` absent;
maintained package lint reports two violations. Exact drafts exist, application
requires permission; no README was edited. External TeX and successful RTF/PPTX
word-processor/presentation QA are still unavailable/not run successfully.
Primary-source research receipts also retain failed RTF 1.9.1 and EPUB2
retrievals in primary-specifications.json. Version/URL identification does not
establish successfully retrieved, hash-verified primary bytes.

## Local integration and ownership

Normal uncached npm run build passed, including maintained workspace dependency
closure and root suffix stages: [build](final-audit-build.log).
Repository npm run lint passed, including types/contracts/workflows:
[lint](final-audit-lint.log). Package lint fails only the two README gates:
[package lint](final-audit-package-lint.log).
Lint reported zero errors and fourteen warnings. Its human diagnostics and guard
summary are retained; the oversized raw receipt body was purged after inspection.
The full-test lane and final pipeline validation are recorded after execution;
no incomplete/stopped or failed test run counts as acceptance.

First full npm test completed with exit 1: 18 failed / 129,481 passed / 2 skipped
tests, plus one worker-start timeout; 18 failed / 2,835 passed / 2 skipped files.
[Original complete failure](final-audit-full-test.log) is retained. This live run
overlapped build/lint and the failing-first frontmatter repair; it cannot certify
the final source. No timeout was dismissed as a pre-existing issue or hidden by
changing limits/skips. All affected timeout files subsequently passed focused
reproductions: [4,809 checks in 16 files](final-audit-timeout-reproduction.log),
[421 codec checks](final-audit-codec-reproduction.log), and
[208 worker-start case checks](final-audit-worker-reproduction.log).
The frontmatter repair has its own red/green/scoped lint evidence.
A fresh full maintained rerun starts after these source/check changes and build
completion; its result remains a separate integration gate.

The actual public CLI `node dist/bin.cjs pipeline validate
docs/plans/pandoc-typescript-safe-bash.md` succeeds after acceptance status
corrections: [validation](final-audit-pipeline.log). Validation does not execute
the pipeline, run inherited steps, finalize it, commit automatically or release.

Atomic task history and exact paths: [Git commit inventory](final-audit-commits.json).
The inventory records 77 nonempty commits at its capture, including SDK wiring,
expanded readers/writers, independent engine work, failing-first regressions,
portable exports, concurrency/budget fixes and separate QA evidence improvements.
It describes actual Git paths, not implied sole ownership of every historical path.
No history was squashed/reverted and no co-author or ignored file was added.

This audit's first local commit is `3cf560ff7`: original frontmatter reproduction,
memfs test fix, maintained scoped lint and its dedicated audit procedure/evidence.
The pending main plan status edits and untracked public-wiring logs were present
before this work and are excluded from task-owned commits. Audited acceptance
annotations are staged separately from those prior pending plan hunks.
