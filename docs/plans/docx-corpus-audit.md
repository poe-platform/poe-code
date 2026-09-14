# Disposable DOCX fixture audit task record

Task: `audit-downloaded-qa-fixtures` only.

Status: Audit complete; local commit delivery only. Later tasks remain pending.

Baseline: `main`, `e594e5ff7924868e12693ee5991e174888cefce9`.

## Ownership and boundaries

Owned paths:

- `docs/docx/corpus-manifest.json`
- `docs/docx/corpus-report.md`
- `docs/docx/corpus-audit-20260914.json`
- This task record.

The main pipeline plan already had unrelated edits, and an unrelated plan move
was present. Neither is owned, changed or staged here. This record supplies the
task outcome without changing their state. Root AGENTS.md applies; no scoped
AGENTS.md exists under docs. All later tasks, beginning with
`fill-corpus-feature-gaps`, remain pending for this execution.

No product source, README, package configuration, canonical tests, specifications
or binaries are changed. No push or release is authorized. No fixture deletion
is needed while product qualification remains pending.

## Agent QA procedure

1. Read the corpus manifest/report, acquisition artifacts, format and shared
   CLI/SDK specifications, API audit/inventory/map and test audit/crosswalk.
   Record main/index/worktree state and preserve unrelated changes.
2. Establish missing documentary evidence before edits. Assert that each file
   has fresh cache verification and a complete explicit classification. Inspect
   historical missing keys rather than interpreting absent counts as proof of
   zero. This is a documentary check, not a product TDD test.
3. Hash each cached file and media payload, match sizes and acquisition receipt
   fields, inspect read-only mode/symlinks/ignore rules, and hash the supporting
   acquisition JSON. Matching inputs require no new download. Preserve inferred
   URL discovery, failed probes and historical HTTP access failures.
4. Read current primary publisher copyright and detailed terms. Inspect bounded
   document notice indicators; retain restrictions and unresolved asset rights.
   Never treat keyword matches or public accessibility as legal clearance.
5. Stream ZIP entries with finite input/expanded/XML/node/depth limits and CRC
   checking. Refuse DTD/entities. Count expanded-name elements, declarations and
   actually used namespaces separately; do not invoke an office application,
   activate embeddings, follow external relationships or retain report text.
6. Reconcile paragraphs/tables/media/fields/sections/OMML and annotations against
   the original census. Distinguish chart definitions from styles/colors,
   substantive note bodies from separators/settings, classic comments from
   modern metadata and actual text from language settings. Inspect MCE fallback
   parents, scoped image references, controls and protection settings.
7. Preserve the annex's old 32 MiB rejection and explicit raised census as
   distinct evidence. Repeat a bounded 32 MiB refusal and compare measured input
   ceilings to the proposed product defaults. Leave semantic admission,
   operation/output budgets, product execution and rendered pages unverified.
8. Update only owned evidence/report files, with explicit zeros, exact corpus
   gaps, license restrictions and current API-map/crosswalk status. Do not start
   gap acquisition or author future product tests in this task. Record later
   original memfs reduction obligations without copying reports or fixtures.
9. Run focused JSON/hash/count/provenance/link assertions, the maintained
   repository formatter on the four owned paths, and `git diff --check`.
   Review the complete owned diff. No runtime/build/CLI screenshot gate applies
   to this documentation-only change; none is claimed as passing.
10. Stage only the four explicit owned paths, inspect the index and commit with
    a Conventional Commit on main without hook bypass or co-author. Verify the
    local commit's paths and remaining unrelated status. Do not push or release.

## Evidence and findings

- Initial presence assertion failed: all 19 lacked fresh `cache_verification`
  and `audited_classification` records; absent feature counts were not explicit.
- All 19 source hashes, sizes and download-receipt fields matched. All 655 media
  hashes matched. All original structural census counts matched when their
  historical definitions were retained. No redownload was necessary.
- A chart-definition assertion failed on the annex: three `c:chartSpace`
  definitions versus nine chart-directory XML parts. The six extra parts are
  styles/colors. Both counts are now distinct; the original record survives.
- Supplemental inspection found 91 modern extensible-comment records and 163
  comment-ID records in the climate-risk report, without classic bodies/anchors.
  Tracking-enabled settings are not recorded changes. No annotation edit or
  semantic cross-reference validity is claimed.
- Root-scoped note inspection found 508 substantive footnotes and zero endnotes.
  Historical counts included separators and settings references. No inspected
  `w:t` characters establish RTL/Han/Kana/Hangul coverage.
- Publisher review retained imagery/logo/third-party restrictions. The Scotland
  template's OGL footer conflicts with detailed commercial-use restrictions;
  reuse clearance remains unresolved. The linked OGL text returned HTTP 403.
- The annex again refused the 32 MiB XML ceiling at 33,619,968 streamed bytes;
  its full XML is 40,415,536 bytes. The separate raised census passed. Eighteen
  files fit measured proposed default input ceilings; no product admission pass
  follows from this result.
- All 60 AlternateContent groups have a fallback; nine files have repeated
  image-target references. No external image relation was found or fetched.
  The report records exact remaining structural, language, security and size gaps.
- Current API and crosswalk evidence resolves historical mapping-state wording:
  920 inventoried IDs, 1,337 proposed API rows, 2,259 mapped source cases and zero
  implemented target tests. Neutral spellings, explicit JS/security mappings,
  inherited/underscore-prefixed APIs and documentation-error dispositions remain
  governed by the existing shared contracts and per-member map.

## Validation and delivery

The focused validation passed: all 19 source hashes, acquisition fields and
read-only permissions match; all 655 media hashes were independently checked;
original census/profile/provenance fields remain semantically unchanged; totals,
explicit zeros, namespace classification, measured admission ceilings and corpus
gaps reconcile. Cache artifact and shared-contract/API authority hashes match.
All owned local Markdown links resolve. The maintained formatter is invoked as
`npm exec --no -- prettier --check` with the four explicit owned paths; this avoids
the root format route's unconditional whole-repository operand. The formatter
and `git diff --check` passed. No product unit/build/runtime/render pass is claimed.

This record does not embed its own commit hash; the delivery response identifies
the verified local commit. All future product tests, visual qualification,
regression reduction and cleanup remain pending. The substantive owned evidence
corrections form one atomic documentary improvement. No push or release occurs.
