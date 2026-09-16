# DOCX performance and explicit trusted profiles

Measured 2026-09-15. This completes only the bounded large-document measurement
and host-profile task. Defaults remain proposed for general readiness; this
campaign qualifies the listed round trips and literal text edits only.

The public engine now accepts optional trusted `documentLimits`. CLI `--limit`
and typed SDK `limit` can only lower host ceilings. Serialization and authenticated
original-byte publication use admitted total-byte/entry capacities instead of the
previous hidden 32 MiB-total/4096-part validation caps. The ordinary per-XML ceiling
remains 32 MiB independently of archive media allowances. The product total-byte
ceiling is the documented 256 MiB; the low-level validator's separate default
32 MiB/200,000-node inspection options remain unchanged. No automatic large profile,
environment configuration, ambient product I/O or product networking was added.

## Machine, runtime and observation method

Mac17,9, Apple M5 Pro, arm64, 25,769,803,776 bytes RAM (24 GiB); macOS 26.4.1
(build 25E253), Node.js v22.23.2, V8 12.4.254.21-node.56. ZIP/XML execution uses
the existing TypeScript engine/codecs, with no native reference build.

Wall time is measured with `performance.now()`. Memory values are observed
`process.memoryUsage()` RSS/heap/external/array-buffer snapshots. Generated full
trials additionally sample RSS/heap with a 10 ms timer. Timer sampling misses
synchronous temporary allocations. OS `process.resourceUsage().maxRSS` is a
process-lifetime high-water value in KiB, not a stage-reset peak. The tables use
the largest retained snapshot/sample for RSS/heap, not an exact peak guarantee.
On macOS, residency and heap statistics can differ due to VM/compression; heap
counters are not resident-memory estimates. Whole-process high-water observations
and all before/after fields are retained in [the numeric receipts](performance-measurements.json).

Other development and QA processes competed during this campaign. GC was explicitly
requested before generated trials; warmup/GC and contention affect wall-time ratios.
There is one measurement per listed stage, no throughput distribution or latency
promise. Product budget `usage` values are conservative cumulative debits, not
observed memory, CPU time, actual live buffers or an RSS isolation guarantee.
Per-item checks such as XML part bytes/depth do not populate byte-debit counters;
a zero usage field does not mean no XML was parsed. Counter tables show work,
retained reservations and parsed nodes separately from observations.

## Exact profiles

| Resource | Product default | Trusted L64 | Trusted L128 |
| --- | ---: | ---: | ---: |
| compressedInput | 67,108,864 | 67,108,864 | 134,217,728 |
| expandedPackage | 268,435,456 | 536,870,912 | 536,870,912 |
| zipEntries | 10,000 | 10,000 | 10,000 |
| xmlPartBytes | 33,554,432 | 134,217,728 | 134,217,728 |
| xmlNodes | 2,000,000 | 50,000,000 | 50,000,000 |
| xmlDepth | 256 | 256 | 256 |
| embeddedMediaBytes | 67,108,864 | 67,108,864 | 67,108,864 |
| retainedBytes | 536,870,912 | 17,179,869,184 | 17,179,869,184 |
| serializedOutput | 268,435,456 | 268,435,456 | 268,435,456 |
| batchOperations | 1,000 | 1,000 | 1,000 |
| matches | 100,000 | 100,000 | 100,000 |
| insertedNodes | 1,000,000 | 1,000,000 | 1,000,000 |
| tableCells | 100,000 | 100,000 | 100,000 |
| tableRows | 10,000 | 10,000 | 10,000 |
| tableColumns | 1,024 | 1,024 | 1,024 |
| diagnosticBytes | 65,536 | 65,536 | 65,536 |
| work | 536,870,912 | 68,719,476,736 | 68,719,476,736 |

L64 and L128 are report labels for explicit settings, not new product presets.
L64 is the initial corpus/generated campaign; L128 increases compressed input to
128 MiB for the original 100 MiB stored-package regime. Both use finite 512 MiB
expanded, 128 MiB XML, 50 million cumulative XML nodes, 16 GiB retained reservations
and 68,719,476,736 work units. Other resources retain the product defaults. The repeated-match
controls use L64 work-unit/retained/node settings with 256 MiB expanded and default
32 MiB XML (their small inputs do not require increased XML capacity).

For L128 the explicit codec settings are maxArchiveBytes/maxEntryBytes 134,217,728;
maxTotalBytes 536,870,912; maxMembers 10,000; maxPathBytes 4096; maxDepth 256;
maxExtraBytes/maxCommentBytes/chunkSize 65,536; maxRetainedBytes 17,179,869,184.
L64 uses maxArchiveBytes 67,108,864 and otherwise the corresponding receipt's
explicit settings. Codec and DocumentBudget bounds both apply. Parameters are
recorded in full for every campaign in the numeric receipts.

Successful packaged Shell retries explicitly set maxOutputBytes 268,435,456,
maxWallClockMs 600,000 and maxCpuMs 600,000. These independent trusted Shell
allowances are required as well as the DOCX profile. Shell ordinary time/CPU
settings remain 30,000 ms. No command flag raises either authority boundary.
Initial 40 MiB XML Shell execution retained ordinary time/CPU settings; the initial
100 MiB Shell trial raised wall time only and still hit the CPU bound. Both
failures remain recorded, followed by successful explicit-profile retries.

## Corpus ceilings and measured default admission

Ordinary seed **census** inspection used 512 MiB expanded and five million XML
nodes; its raised census used 128 MiB XML. **Product** defaults are 256 MiB expanded,
two million cumulative parsed nodes and 32 MiB per XML part. The annex has
40,415,536 main-XML bytes and 47,777,441 expanded bytes. Its historical 1,226,106
node count is an element census. Actual product admission charges **3,083,167**
elements, attributes and retained content nodes across its parsed trees. Validation
raises cumulative parsed-node usage to 6,200,597. Those are accounting observations,
not new census totals or a count of unique document elements.

Eighteen census size candidates do not establish product default admission.
With the actual default ledger, 6 of 19 files admit, 12 exceed work and one fails
OPC admission. The default work reserve is 64 units per expanded byte plus input
and XML work; it can reject roughly 8 MiB expanded inputs before XML parsing.
This conservative accounting is materially stricter than the byte-only census.
None of these failures was silently converted to success.

| Acquired file | Input bytes | Default outcome | Wall s | Observed RSS / heap MiB |
| --- | ---: | --- | ---: | ---: |
| circular-economy.docx | 8320866 | limit-exceeded: work | 0.650 | 175.5 / 36.8 |
| gst-reforms-interim-appendixb.docx | 101772 | ok | 1.300 | 226.7 / 69.2 |
| gst-reforms-interim-appendixc.docx | 187689 | ok | 2.958 | 285.4 / 121.8 |
| gst-reforms-interim-appendixd.docx | 273146 | ok | 1.540 | 285.4 / 141.0 |
| gst-reforms-interim-appendixe.docx | 157148 | ok | 0.911 | 245.7 / 141.0 |
| gst-reforms-interim-sp1.docx | 264839 | ok | 2.107 | 231.0 / 106.2 |
| gst-reforms-interim.docx | 6009233 | limit-exceeded: work | 0.500 | 242.6 / 106.3 |
| housing-supply-interim.docx | 6360759 | limit-exceeded: work | 0.469 | 258.6 / 27.8 |
| mental-health-review.docx | 9290427 | limit-exceeded: work | 0.554 | 276.4 / 26.4 |
| ministry-for-the-environment-annual-report-2024-2025.docx | 10219701 | limit-exceeded: work | 0.378 | 273.7 / 26.5 |
| national-climate-change-risk-assessment-main-report.docx | 7275939 | limit-exceeded: work | 0.256 | 255.3 / 25.3 |
| new-zealands-second-emissions-reduction-plan-discussion-document.docx | 13582467 | limit-exceeded: work | 0.503 | 264.4 / 25.6 |
| nz-ghg-inventory-2025-vol-1.docx | 20543015 | limit-exceeded: work | 0.727 | 270.9 / 24.9 |
| nz-ghg-inventory-2025-vol-2.docx | 7944279 | limit-exceeded: work | 0.509 | 213.8 / 26.3 |
| our-atmosphere-and-climate-2023.docx | 5425219 | limit-exceeded: work | 4.584 | 207.8 / 125.4 |
| our-future-rm-system-developing-the-npf.docx | 21125727 | limit-exceeded: work | 0.569 | 184.9 / 125.4 |
| scotland-annual-progress-report-2026-template-v1.docx | 157858 | invalid-package: OPC admission | 0.194 | 208.8 / 114.2 |
| wales-citizen-voice-easy-read.docx | 4409375 | ok | 5.341 | 242.1 / 136.3 |
| wales-race-equality-response-images.docx | 20568111 | limit-exceeded: work | 0.634 | 292.5 / 136.3 |

All 19 source SHA-256 values still match acquisition receipts after the campaign;
exact hashes/byte sizes are retained in the numeric receipts. Downloads were only
immutable disposable QA inputs. No new acquisition or renderer/page measurement
is claimed. The existing corpus/provenance evidence remains unchanged.

The annex's default rejection was exercised through the actual SDK and Shell,
then two isolated host changes identified subsequent bounds. Shell diagnostics
remain bounded/redacted; detailed SDK messages identify the resource.

| Annex profile | Route | Outcome | Wall s |
| --- | --- | --- | ---: |
| default | sdk | Document work limit exceeded. | 0.448 |
| default | shell | exit 4 / limit-exceeded | 2.842 |
| work-only | sdk | Document admission retained byte budget exceeded. | 1.639 |
| work-only | shell | exit 4 / limit-exceeded | 3.930 |
| work-retained | sdk | XML byte or work limit exceeded. | 1.689 |
| work-retained | shell | exit 4 / limit-exceeded | 4.157 |

`work-only` raises work to 68,719,476,736 units; `work-retained` additionally raises retained
reservations to 16 GiB. Both retain default XML/node/expanded ceilings. Increasing
XML alone therefore does not qualify the annex. Under L64 it admits, but subsequent
semantic validation rejects incompatible next-style definition kinds. Volume 1
also admits under L64 and then fails the same selected style relationship rule.
These are preserved invalid-package results, not successful round trips; the
small original next-style regression retains this finding independently of downloads.

## Reproducible original stress fixtures

All generated inputs are **original stress fixtures**, not downloaded documents.
Start with `createDocumentArchive({})`, retain its original metadata/styles, replace
only body XML for text/dense regimes, and serialize with public `writeArchive`
(store compression, name order, original fixed timestamps). The word namespace is
the ordinary transitional wordprocessing namespace. Each body ends in `w:sectPr`.
All XML-heavy trials start with a paragraph containing `Coastal observation`.

Text controls append a second paragraph whose one run contains
`'Original field note. '.repeat(Math.ceil(N / 21)).slice(0, N)`, with N = 1, 2, 4
or 40 MiB; measured XML is N + 209 bytes. Dense controls append
`<w:p><w:r><w:t>Original field note.</w:t></w:r></w:p>` 1000, 2000, 4000 or 25,000
times. The full dense input has 25,001 paragraphs and 1,325,176 main-XML bytes.

The 20/100 MiB regimes retain a created paragraph `Coastal observation` and add
`original/measurements.bin`, content type application/octet-stream (original
Default Extension=bin declaration). Payloads contain exactly 20 or 100 MiB of
original deterministic bytes: seed 0x6d2b79f5; for each byte update state with
`state ^= state << 13; state ^= state >>> 17; state ^= state << 5`; store
`state & 255`. No host randomness is used. These exercise large archive/copy/output
regimes separately from dense XML; they do not qualify a media item over its
64 MiB default ceiling or prove opaque object semantics.

Repeated-match controls have one paragraph with
`<w:r><w:t>x</w:t></w:r>` repeated 128/256/512/1024/2048/4096 times, and replace
x with y using explicit all-selection. They isolate multiplicity from input bytes.
Fixtures exist only under locally ignored `.cache/docx-performance-qa`; none ships
or becomes a canonical unit fixture. The missing downloaded two-input
20 MiB/100 MiB acquisition regime remains **unfulfilled**.

## Successful round trips and targeted edits

The 100 MiB and dense full campaigns execute factories/serialization/edits through
package exports `docx`, `virtual-bash` and `virtual-bash/commands/docx`. Initial
L64 trials also execute the same declared public SDK exports through their source
index. Round trips reopen validated stored packages and compare every member's
SHA-256/bytes. For these original inputs the complete archive hash is unchanged.
Targeted edits replace Coastal with Harbor, first match, paragraph 1 when specified,
using SDK `replaceDocumentText` and actual Shell
`docx text replace - --find Coastal --with Harbor --first --paragraph 1 --output -`.
Verification uses public text extraction or archive admission plus decoded targeted
XML and unchanged unselected-member hashes. Input hashes remain unchanged, and
SDK/Shell edited hashes agree. No editing of the downloaded annex is claimed.

| Original fixture | Input bytes | Main XML bytes / density | Round trip | SDK edit | Shell edit |
| --- | ---: | --- | --- | --- | --- |
| original-binary-20 | 20973851 | 20 MiB opaque payload | passed | passed | passed |
| original-binary-100 | 104859931 | 100 MiB opaque payload | passed | passed | passed |
| large-text | 41944948 | 41943249 XML bytes | passed | passed | passed |
| dense-roundtrip | 1326875 | 1325176 XML bytes / 25,001 paragraphs | passed | passed | passed |

Exact SHA-256 values follow. Input and validated round-trip output hashes agree;
edited hashes are separately recorded. Large text uses the successful packaged
Shell retry, and 100 MiB uses the successful L128 packaged SDK/Shell receipts.

| Fixture | Input / round-trip SHA-256 | SDK and Shell edited SHA-256 |
| --- | --- | --- |
| original-binary-20 | 9e093fb86c827842eb9ecc2b883d7267d659e42280360f2bdca638c217becea5 | 056cde0802829128b58e38c0fea3d0dcf18554a3f2a23ee255873ae571260527 |
| original-binary-100 | dd76a1b291e8a5abea40832dba943cf9581873687425c335ed73de9203594cbd | a56d0c45be0839c76d3db5852bdefe6721be5965fadfc1b2e1e0df0306aaa2ad |
| large-text | 0f68074179dfba4e07a0ba1be0feaf966b7d059850469cd28dca34efc5f7b34a | e007d2deef2a59e0f5254528506fe8a56d791ff49e94b693463bdc3a49a8a1e8 |
| dense-roundtrip | 1ddaeb423eb30e3710be2e74dca08bb0dfad14984af1df4ef615ee54a6f303a0 | 5757424d1b9c294b69a593cd06d5b79e6b14876ef5043c4f205bb636ac83ec51 |

Default SDK/Shell rejection on the generated 20 MiB archive is work exhaustion;
the stored 100 MiB package exceeds default compressed input. Both ordinary Shell
results are exit 4; profiles explicitly raise limits for success. A CLI increase
above host xmlNodes rejects with usage/exit 2, and a lowered limit rejects with
exit 4 without output. The original memfs regressions cover both SDK and Shell.

## Per-stage observations and independent counters

A budget is shared across validation/serialization in a trial and reset only at
explicit new invocations. Thus columns below are **cumulative**, not phase-local
allocation totals. Public admission includes archive decoding; separate archive-read
controls use another budget and must not be subtracted as an exact XML-only cost.
Validation covers the declared partial semantic profile, not full XSD conformance.
Store encoding is used for generated round trips and target edits; the corpus
serialization trial uses deflate. Successful Shell text publication uses the
engine's maintained encoding; byte comparisons verify exact payload retention.

| Campaign / fixture / stage | Wall s | Observed RSS / heap MiB | Reserved GiB | Work / 2³⁰ units | Parsed nodes | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| raised-corpus / gst-reforms-interim-appendixc.docx / archive | 0.180 | 167.6 / 26.7 | 0.002 | 0.097 | 0 | ok |
| raised-corpus / gst-reforms-interim-appendixc.docx / admission | 2.825 | 225.1 / 83.8 | 0.034 | 0.120 | 101108 | ok |
| raised-corpus / gst-reforms-interim-appendixc.docx / validation | 0.742 | 339.5 / 178.5 | 0.077 | 0.160 | 235077 | ok |
| raised-corpus / gst-reforms-interim-appendixc.docx / serialize | 1.089 | 369.5 / 294.9 | 0.131 | 0.296 | 369046 | ok |
| raised-corpus / nz-ghg-inventory-2025-vol-1.docx / archive | 1.493 | 441.4 / 55.6 | 0.107 | 2.089 | 0 | ok |
| raised-corpus / nz-ghg-inventory-2025-vol-1.docx / admission | 21.116 | 664.1 / 393.6 | 0.347 | 2.259 | 776183 | ok |
| raised-corpus / nz-ghg-inventory-2025-vol-1.docx / validation | 4.858 | 1301.6 / 723.1 | 0.651 | 2.699 | 1582695 | invalid-package: style-next-type |
| raised-corpus / nz-ghg-inventory-2025-vol-2.docx / archive | 1.649 | 1315.3 / 255.0 | 0.074 | 2.907 | 0 | ok |
| raised-corpus / nz-ghg-inventory-2025-vol-2.docx / admission | 105.165 | 1315.3 / 1273.2 | 0.895 | 3.479 | 3083167 | ok |
| raised-corpus / nz-ghg-inventory-2025-vol-2.docx / validation | 68.511 | 1366.7 / 2502.5 | 1.934 | 4.494 | 6200597 | invalid-package: style-next-type |
| generated-metrics / text-1 / fixture-store | 0.108 | 195.2 / 42.6 | 0.006 | 0.063 | 182 | ok |
| generated-metrics / text-1 / archive-read | 0.102 | 198.3 / 43.0 | 0.005 | 0.070 | 0 | ok |
| generated-metrics / text-1 / public-admission | 1.951 | 251.8 / 69.8 | 0.021 | 0.083 | 44 | ok |
| generated-metrics / text-1 / validation | 0.149 | 291.5 / 101.9 | 0.036 | 0.104 | 120 | ok |
| generated-metrics / text-2 / fixture-store | 0.190 | 305.6 / 39.0 | 0.010 | 0.125 | 182 | ok |
| generated-metrics / text-2 / archive-read | 0.155 | 308.5 / 39.1 | 0.010 | 0.141 | 0 | ok |
| generated-metrics / text-2 / public-admission | 3.859 | 309.4 / 107.8 | 0.041 | 0.166 | 44 | ok |
| generated-metrics / text-2 / validation | 0.288 | 300.4 / 107.8 | 0.073 | 0.207 | 120 | ok |
| generated-metrics / text-4 / fixture-store | 0.345 | 330.0 / 44.9 | 0.020 | 0.250 | 182 | ok |
| generated-metrics / text-4 / archive-read | 0.234 | 330.0 / 38.5 | 0.020 | 0.281 | 0 | ok |
| generated-metrics / text-4 / public-admission | 7.559 | 332.9 / 177.4 | 0.082 | 0.332 | 44 | ok |
| generated-metrics / text-4 / validation | 0.524 | 277.2 / 303.5 | 0.145 | 0.414 | 120 | ok |
| generated-metrics / dense-1 / fixture-store | 0.028 | 289.1 / 39.6 | 0.001 | 0.003 | 182 | ok |
| generated-metrics / dense-1 / archive-read | 0.044 | 289.1 / 39.8 | 0.000 | 0.004 | 0 | ok |
| generated-metrics / dense-1 / public-admission | 0.163 | 291.1 / 48.9 | 0.001 | 0.004 | 4040 | ok |
| generated-metrics / dense-1 / validation | 0.047 | 295.4 / 48.5 | 0.002 | 0.005 | 8112 | ok |
| generated-metrics / dense-2 / fixture-store | 0.033 | 289.0 / 36.6 | 0.001 | 0.007 | 182 | ok |
| generated-metrics / dense-2 / archive-read | 0.049 | 289.0 / 36.8 | 0.001 | 0.007 | 0 | ok |
| generated-metrics / dense-2 / public-admission | 0.294 | 289.0 / 48.3 | 0.002 | 0.008 | 8040 | ok |
| generated-metrics / dense-2 / validation | 0.081 | 286.4 / 56.6 | 0.004 | 0.010 | 16112 | ok |
| generated-metrics / dense-4 / fixture-store | 0.041 | 289.6 / 39.7 | 0.002 | 0.013 | 182 | ok |
| generated-metrics / dense-4 / archive-read | 0.056 | 289.8 / 40.0 | 0.001 | 0.014 | 0 | ok |
| generated-metrics / dense-4 / public-admission | 0.452 | 296.8 / 54.7 | 0.004 | 0.017 | 16040 | ok |
| generated-metrics / dense-4 / validation | 0.146 | 301.9 / 74.4 | 0.008 | 0.021 | 32112 | ok |
| generated-metrics / large-text / fixture-store | 3.335 | 477.9 / 115.8 | 0.196 | 2.500 | 182 | ok |
| generated-metrics / large-text / archive-read | 2.151 | 467.7 / 70.7 | 0.196 | 2.813 | 0 | ok |
| generated-metrics / large-text / public-admission | 92.691 | 747.1 / 1417.2 | 0.821 | 3.320 | 44 | ok |
| generated-metrics / large-text / validation | 11.118 | 944.8 / 1456.8 | 1.446 | 4.141 | 120 | ok |
| generated-metrics / large-text / validated-store | 17.653 | 1015.6 / 1456.9 | 2.266 | 7.461 | 196 | ok |
| generated-metrics / large-text / reopen | 69.592 | 1502.7 / 1457.6 | 0.821 | 3.320 | 44 | ok |
| generated-metrics / large-text / sdk-text-replace | 171.657 | 1398.5 / 1604.1 | 14.493 | 14.688 | 745 | ok |
| generated-metrics / large-text / sdk-edit-verification | 79.002 | 1394.0 / 1524.6 | 2.188 | 4.453 | 193 | ok |
| generated-metrics / large-text / shell-text-replace | 30.002 | 1497.0 / 1524.7 | — | — | — | undefined: Shell limit exceeded: maxWallClockMs |
| binary-metrics / original-binary-20 / fixture-store | 1.493 | 303.9 / 38.0 | 0.098 | 1.250 | 197 | ok |
| binary-metrics / original-binary-20 / default-sdk | 0.447 | 332.5 / 29.5 | 0.098 | 0.156 | 0 | limit-exceeded: Document work limit exceeded. |
| binary-metrics / original-binary-20 / public-admission | 0.967 | 337.8 / 30.3 | 0.098 | 1.406 | 58 | ok |
| binary-metrics / original-binary-20 / validation | 0.004 | 338.0 / 30.4 | 0.098 | 1.563 | 151 | ok |
| binary-metrics / original-binary-20 / validated-store | 1.452 | 366.8 / 31.6 | 0.196 | 2.969 | 244 | ok |
| binary-metrics / original-binary-20 / reopen | 1.031 | 366.8 / 30.1 | 0.098 | 1.406 | 58 | ok |
| binary-metrics / original-binary-20 / sdk-text-replace | 2.526 | 461.7 / 31.6 | 0.392 | 3.438 | 961 | ok |
| binary-metrics / original-binary-20 / sdk-edit-verification | 1.099 | 521.9 / 32.0 | 0.157 | 1.621 | 238 | ok |
| binary-metrics / original-binary-20 / shell-default | 6.948 | 498.1 / 38.1 | — | — | — | exit 4 / limit-exceeded |
| binary-metrics / original-binary-20 / shell-large | 11.579 | 328.2 / 69.1 | — | — | — | ok |
| binary-metrics / original-binary-20 / shell-edit-verification | 1.647 | 277.0 / 70.7 | 0.157 | 1.621 | 238 | ok |
| binary-metrics / original-binary-100 / fixture-store | 10.224 | 519.2 / 32.9 | 0.489 | 6.250 | 197 | ok |
| binary-metrics / original-binary-100 / default-sdk | 0.002 | 478.5 / 30.6 | 0.000 | 0.000 | 0 | limit-exceeded: Archive byte budget exceeded. |
| binary-metrics / original-binary-100 / public-admission | 5.909 | 683.4 / 31.1 | 0.489 | 7.031 | 58 | ok |
| binary-metrics / original-binary-100 / validation | 0.003 | 259.1 / 31.0 | 0.489 | 7.813 | 151 | ok |
| binary-metrics / original-binary-100 / validated-store | 8.841 | 510.2 / 32.0 | 0.977 | 14.844 | 244 | ok |
| binary-metrics / original-binary-100 / reopen | 5.062 | 588.5 / 32.0 | 0.489 | 7.031 | 58 | ok |
| binary-metrics / original-binary-100 / sdk-text-replace | 13.586 | 719.7 / 33.7 | 1.954 | 17.188 | 961 | ok |
| binary-metrics / original-binary-100 / sdk-edit-verification | 5.580 | 920.7 / 33.0 | 0.782 | 8.106 | 238 | ok |
| binary-metrics / original-binary-100 / shell-default | 0.197 | 809.4 / 32.6 | — | — | — | exit 4 / limit-exceeded |
| binary-metrics / original-binary-100 / shell-large | 49.969 | 900.8 / 34.2 | — | — | — | undefined: Shell limit exceeded: maxCpuMs |
| dense-metrics / dense-roundtrip / fixture-store | 0.110 | 149.0 / 46.5 | 0.007 | 0.079 | 182 | ok |
| dense-metrics / dense-roundtrip / public-admission | 2.129 | 240.7 / 110.6 | 0.026 | 0.104 | 100040 | ok |
| dense-metrics / dense-roundtrip / validation | 0.605 | 394.1 / 261.1 | 0.046 | 0.130 | 200112 | ok |
| dense-metrics / dense-roundtrip / validated-store | 0.707 | 423.3 / 264.4 | 0.072 | 0.234 | 300184 | ok |
| dense-metrics / dense-roundtrip / reopen | 2.280 | 503.5 / 360.7 | 0.026 | 0.104 | 100040 | ok |
| dense-metrics / dense-roundtrip / sdk-text-replace | 14.936 | 615.1 / 808.1 | 0.539 | 0.465 | 1600681 | ok |
| dense-metrics / dense-roundtrip / sdk-edit-verification | 7.610 | 475.2 / 918.2 | 0.126 | 0.147 | 300181 | ok |
| dense-metrics / dense-roundtrip / shell-text-replace | 16.804 | 825.2 / 1002.5 | — | — | — | ok |
| dense-metrics / dense-roundtrip / shell-edit-verification | 6.570 | 827.9 / 1106.6 | 0.126 | 0.147 | 300181 | ok |
| packaged-shell / original-binary-100 / packaged-shell-text-replace | 43.558 | 1555.6 / 215.1 | — | — | — | ok |
| packaged-shell / original-binary-100 / packaged-shell-verification | 11.087 | 1577.8 / 215.2 | 0.977 | 14.063 | 0 | ok |
| packaged-shell / large-text / packaged-shell-text-replace | 168.316 | 1617.6 / 1480.2 | — | — | — | ok |
| packaged-shell / large-text / packaged-shell-verification | 4.842 | 549.9 / 226.5 | 0.391 | 5.625 | 0 | ok |
| packaged-sdk / original-binary-100 / public-admission | 5.179 | 288.6 / 13.3 | 0.489 | 7.031 | 58 | ok |
| packaged-sdk / original-binary-100 / validated-store | 7.872 | 270.8 / 13.7 | 0.977 | 14.063 | 151 | ok |
| packaged-sdk / original-binary-100 / reopen | 6.031 | 470.8 / 14.8 | 0.489 | 7.031 | 58 | ok |
| packaged-sdk / original-binary-100 / sdk-text-replace | 20.200 | 571.4 / 14.9 | 1.954 | 17.188 | 961 | ok |
| packaged-sdk / original-binary-100 / sdk-edit-verification | 7.335 | 753.3 / 14.8 | 0.488 | 7.031 | 0 | ok |
| bounded-match-controls / 128 runs / SDK all-match replacement | 0.617 | 158.5 / 42.1 | 0.029 | 0.018 | 74468 | ok |
| bounded-match-controls / 256 runs / SDK all-match replacement | 1.447 | 198.4 / 51.2 | 0.109 | 0.063 | 279396 | ok |
| bounded-match-controls / 512 runs / SDK all-match replacement | 5.687 | 198.0 / 75.8 | 0.422 | 0.236 | 1082468 | ok |
| match-controls / 1024 runs / SDK all-match replacement | 18.506 | 283.5 / 129.8 | 1.659 | 0.918 | 4261476 | ok |
| match-controls / 2048 runs / SDK all-match replacement | 77.747 | 288.4 / 40.6 | 6.582 | 3.618 | 16910948 | ok |
| failed-match-retry / 4096 runs / SDK all-match replacement | 204.048 | 287.4 / 74.8 | 15.997 | 8.412 | 46542496 | limit-exceeded: Document retainedBytes limit exceeded. |

Initial failed Shell stages retain observed timing/memory and error outcomes.
The separate 4096-run stress attempt failed before publication at retainedBytes
16 GiB during candidate parsing; its elapsed/memory/usage observations were not
retained by that initial recorder and are explicitly null in the numeric receipt.
No values are estimated for that initial attempt. A separate same-profile retry
records 204.048 seconds, 287.4 MiB sampled/snapshot RSS and 74.8 MiB heap, with
333.2 MiB OS process high-water RSS. It accepts 17,176,330,921 retained reservation
bytes, 9,032,038,495 work units and 46,542,496 parsed nodes before the next retained
charge fails. Serialized output is zero and the sink receives **zero writes**.
The historical nulls remain separate from these measured retry values. The three
later bounded controls also retain all fields.

## Scaling findings and qualification boundary

One/two/four MiB text public admission takes 1.951/3.859/7.559 seconds; validation
0.149/0.288/0.524 seconds. The 1000/2000/4000-paragraph admission controls take
0.163/0.294/0.452 seconds; validation 0.047/0.081/0.146 seconds. These controls
show no demonstrated superlinear growth in those measured read/validation regimes.
The 40 MiB XML trial is slower than a simple extrapolation, with GC/contention
and much larger allocations; a single larger point cannot establish its cause.

Repeated-run **all-match replacement is superlinear**. Doubling 256 to 512 runs
raises time from 1.447 to 5.687 seconds (3.93x), cumulative nodes from 279,396 to
1,082,468 (3.87x), reservations from 117,161,164 to 452,619,724 bytes (3.86x),
and work from 67,189,559 to 253,630,775 units (3.77x). The larger controls take
18.506/77.747 seconds at 1024/2048 runs, with 4,261,476/16,910,948 cumulative
nodes and 1,780,994,060/7,067,571,340 reserved bytes. Observed RSS is much smaller
than these nonrefunded reservations. Candidate replacement reparses the growing
XML after each run replacement; matching also scans the leaf collection per match.
These mechanisms explain the counter growth; wall measurements are separate evidence.
The 4096-run profile failure is preserved, not fixed by automatically raising limits.

A small eight-run original regression first proves ordinary text read succeeds
under a 500-node ceiling, then asserts all-match editing exhausts that same ceiling
without a sink write or memfs change. It preserves the failure/publication invariant;
this task does **not** claim to optimize all-match reparsing. Large-profile success
on a single targeted edit is not a linear-scaling or general 100,000-match guarantee.
No automatic default increase is justified by this campaign. Work/retained/node
accounting and all-match scaling still limit general readiness; full model APIs and
later pipeline tasks remain pending.

## Mapping, checks and delivery

Exact safe-integer camelCase host/operation mappings, asynchronous owned-byte
boundaries, capability-scoped VFS, neutral errors and unchanged inherited/public
model obligations are recorded in [the bounded plan](../plans/docx-large-document-profiles.md#exact-javascriptsecurity-mapping-and-documentation-drift).
The census-versus-product and hidden-validation-cap drift is resolved here without
rewriting historical API inventory/audit or excluding public underscore-prefixed
owners, enums, helpers, collections or untested inherited APIs.

Maintained checks: DOCX workspace test (167 files / 3353 tests), DOCX lint including
source/test TypeScript checks (zero errors; one existing unrelated warning), explicit
DOCX build closure (five declared build stages), virtual-bash maintained typecheck
(source/tests and 26 current consumer groups), focused original profile regressions
(six tests), and actual Shell DOCX/profile registration checks (17 tests). The extra
sixth small regression and its read precondition passed the focused run after the
workspace pass. No broad root/shared infrastructure or adapter code changed.

Inspected actual Shell limit-error screenshot: bounded neutral diagnostic, readable
layout, no document text leakage. Help capture also preserves the existing command
syntax; no screenshot tests or new artwork were authored. Only owned files/hunks
are committed on main. No push or release is authorized or claimed.

Local implementation commit: `9a0c70dc93da61a588142270280aa9ce7179af02`.
Performance evidence and only this task's pipeline statuses are a separate owned
documentation commit; later tasks remain pending. No remote delivery or release.

Disposable fixture cleanup: only the four owned generated DOCX inputs were removed
after verification; their recipes, hashes and numeric evidence are retained.
The pre-existing 19-file acquired corpus and unrelated output trees were preserved.
Small locally ignored QA receipts/screenshots remain available for review.
