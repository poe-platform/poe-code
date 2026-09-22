# pdfinfo independent acceptance matrix

Task `research-pdfinfo`, 2026-09-21. See [the pinned specification](safe-bash-pdfinfo-research.md) for source receipts, exact formatting and implementation ownership. **Acceptance remains open:** current main has no pdfinfo implementation. This matrix is independent of future implementation tests; expected values must come from immutable-source/manual native controls, never product-generated fixtures or snapshots.

## Evidence and fixture contract

Pin Poppler `0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46`, version26.09.90, archive SHA256 `e9834d9e5e9269e241d9638e97e32867cdf56140b87af74d0fb9f58a326e158a`; retain the exact macOS build profile in the specification. E below means supplied executed fragment; S source-derived expectation; O missing independent receipt. Every implementation result is O. The supplied aggregate326 observations includes24 pdfinfo and30 pdftotext flag cases over file/stdin profiles; it is not326 pdfinfo passes. Additional36 metadata-encoding invocations are distinct controls.

| Fixture family | Supplied description | Retention gap |
| --- | --- | --- |
| P3 | Original1236-byte three-page PDF, Helvetica12; page1 Hello world/alpha beta; page2 hyphen-/ation and column two, CropBox; page3 empty Rotate90; inherited MediaBox216×144/resources; Info date/controlTitle/customOdd | Exact bytes, SHA256, lexical values, CropBox coordinates and original/native full reports O |
| P3 profiles | Six file profiles plus stdin; password/open/empty/unknown/damaged observations | Exact six-profile inventory and encrypted fixture provenance O; do not infer undocumented profiles |
| B12 | Twelve original PDF2.0 one-page72×144 fixtures, Title hex strings and Metadata XML; title cases enumerated in specification | All fixture hashes/bytes and full36 stdout/stderr/status receipts O |
| Proposed inventory/geometry fixtures | Info absent/non-string/custom keys; MarkInfo; AcroForm/XFA; JS actions; name-tree/dictionary destinations; URI annotations; structure; box/version/subtype/linearization | Not executed; independent generation and pinned controls O |
| Proposed malformed/security fixtures | Cycles/bad parents/xrefs/filters; encryption revisions/permissions; date/encoding boundary and budget cases | Not executed; native compatibility and first-party safety receipts are separate O cells |

Each retained native receipt must identify source/archive/executable/asset hashes, platform/tool/library versions, enabled/disabled features, C library, invocation locale/timezone, exact argv operand bytes, input hash/byte length and source kind, stdout/stderr byte arrays or base64 plus hashes, process status and any effects. Preserve NUL/TAB and trailing spaces/LFs; rendered terminal text is insufficient. A reconstructed similar PDF is a new fixture and needs new goldens.

## Compatibility cells

| ID | Invocation/fixture | Expected stdout/stderr/status evidence | Native qualification still required |
| --- | --- | --- | --- |
| ARG | All exact flags/help aliases; repeats; options after filename; `--`; unknown/grouped/equals forms; missing operand; empty/sign-only integer | S native parse and help/version/arity precedence; status99 ordinary invalid invocation; explicit help/version0 | Full bytes and each interaction O |
| ENC | Default/UTF8 and every advertised map; unknown name; `-listenc` with invalid enc/range/input/arity/help | E invalid encoding99; S listenc before encoding/open/range; labels remain ASCII | Exact list, maps, unmappable text, built-in versus ambient-map boundary O |
| MOD | Every pair among meta/custom/js/struct/dests/url, both argv orders; struct-text; box/date modifiers | S meta>custom>js>struct>dests>url>ordinary, struct-text implies struct, isodates wins rawdates | Pairwise full stdout/stderr/status O |
| RNG | P3 default/f0/l0/l−1/l>count/f2/f4/f2l1/f2l2; same ranges in each mode | E f0→1, l0 sentinel, clamp, f4/f2l1→99; f2→0 and no size/rotation | Full outputs/diagnostics O; original l controls distinguish multipage labels |
| BOX | P3 `-box`, `-f 2 -box`, `-f 2 -l 2 -box`; inherited boxes/defaults/rotation | S f2 withoutl still prints page2 boxes despite absent size/rotation; `%8.2f`, five-box order | Exact coordinates/rounding/labels and mode interactions O |
| GEO | CropBox sizes; rotations/nonzero origins; letter/A0–A6, swapped orientation, tolerance boundaries | S CropBox `%g`, strict tolerances and prefixes in spec | Full boundary/precision reports O |
| ORD | P3 ordinary report; absent/non-string/empty Info; custom non-string keys | E title LF→?, TAB retained; S fixed field order; custom presence differs from printable custom values | Complete byte golden and omission/presence cases O |
| INV | MarkInfo bits/tree; none/AcroForm/XFA; doc/page JS actions; version overrides; linearized/subtype | S exact yes/no/form labels and document helpers | Every inventory branch, JS range effects and subtype family O |
| CUS | P3/B12 custom; Trapped; multibyte/control/long keys; duplicate names; non-string values | E custom only metadata, no summary; S sorted keys/string-only/date precedence/codepoint padding | Full sorted/padded reports O |
| DAT | P3 normal/raw/ISO/both orders; partial/invalid/offset-hour-only/zero offset | E UTC date fragment `Mon Jan  1 21:34:05 2024 UTC`; ISO `2024-01-02T03:04:05+05:30`; partial defaults; raw D prefix/quotes | Full lines O; +HH vs +HH:00, time_t−1, invalid calendar/legacy/locale/DST/non-ASCII/NUL cases O |
| TXT | All12 B12 titles in ordinary/custom; literal versus hex; UTF16 boundaries/UTF8 malformed/language escapes | E36 successful/no-diagnostic invocations across3 modes; BOM/rawUTF8/PDFDoc/NUL/surrogate fragments in spec | Full36 outputs/fixtures O; remaining boundary/maps separately O |
| MET | B12 meta; metadata absent/empty/NUL/control/XML malformed; varied enc | E NUL-containing stream exactly `<root>before\n`, stderr empty,status0; S LF permitted/NUL truncation/appended LF | Full other outputs O; SDK retained bytes/XML view separately required |
| URL | Link URI actions, non-URI/text-only URLs, page ranges/base-relative URI/control bytes, enc changes | S header `Page  Type          URL\n`; URI annotation rows, inert bytes | All native full outputs O; no content-text scan/fetch claim |
| DST | Name-tree+legacy dictionary; duplicate name/page; numeric/nonexistent targets; every destination kind/null coordinates/range | S header `Page  Destination                 Name\n`; page-ref-only, sorted names, fixed27-byte cell | All full native outputs O |
| JST | Every JSInfo location, no JS, string/stream script, malformed graph and range | S inventory/source printing only; never execution | Exact labels/source/diagnostics/status O |
| STR | No tree, tags/IDs/attributes/object refs/content; struct-text; cycles/malformed structure and f/l | S logical-tree helpers, struct-text implies struct; range validated first | Every exact indentation/content/diagnostic/status O |
| SEC | No/wrong/user/owner password; permission combinations; RC4/AES/AES-256; truncation/sentinel/multibyte | E wrongpassword1; authorized AES-256 summary labels; S permission helpers(true) | Full encrypted receipts, revisions, password precedence and bytes O |
| ERR | Missing/unreadable/unknown/empty; bad encoding/range; recovered startxref | E open/password/unknown/empty1; encoding/range99; damaged startxref1 recovered0 without stderr in P3 only | Full diagnostics O; no general malformed recovery acceptance |
| SIZE | P3 VFS-named versus stdin, all ordinary range/box forms; SDK input length | E stdin line `File size:       0 bytes\n`, input1236; S file-size field independent | Full native reports O; SDK actual-length field separately required |

## First-party and delivery gates

These controls establish isolation/product behavior, not Poppler compatibility. Numeric budget policy and failure statuses must be specified by the accepted engine contract before assertions are written.

| Gate | Required independent proof | Status |
| --- | --- | --- |
| Parser prerequisites | Metadata/security/page-tree gates with byte-preserving object/stream views; no PDF substring heuristic | O |
| CLI/SDK | Same admitted byte argv, modes, date/encoding/profile/status/output; explicit raw SDK views and size/metadata distinctions | O |
| Resource accounting | Pre-admission input/output/retained/object/decoded/graph/security/serializer bounds, rollback, falsey thrown values, chunk independence | O |
| Cancellation/cleanup | Explicit signal at each capability call; before/during reads/writes/decode/traversal; awaited backpressure and idempotent invocation cleanup on every exit | O |
| Host isolation | Memory VFS/mocked capabilities; no executable/ambient file/network/JS execution/link fetch/extraction/fallback/download authority | O |
| Ownership/replay | Canonical byte carriers/context/constructors across root/contracts/command exports; realm, checkpoint and replay lifetime/reservation tests | O |
| Workspace ownership | Exact private command name/folder; TypeScript ESM; no external shipped runtime deps; no command→safe-bash edge; opt-in composition | O |
| Installed runtime/types | Maintained guarded build and pack; isolated installed `@poe-platform/safe-bash/commands/pdfinfo` import with no command workspace; no leaked unpublished JS/d.ts specifiers | O |
| Actual supported runtimes | Each advertised runtime/realm exercised independently; declarations or a dependency-free manifest do not prove runtime support | O |
| Manual visual QA | Screenshots of actual CLI outputs when visual behavior exists; no screenshot unit tests | O |

## Manual qualification procedure

1. Identify the candidate by HEAD plus working-tree source hashes. Reinspect current implementation/tests before proposing changes; reproduce each runtime gap with a failing memory-VFS test or concrete observation.
2. Acquire retained originals/receipts or generate independently identified new fixtures. Run pinned native manual controls under explicit environment. Keep host-native research outside the product and unit suite; no QA script replaces this markdown procedure.
3. Compare complete stdout/stderr/status bytes per cell, including empty output, NUL, spacing, ordering and diagnostics. Do not infer success from downstream pipeline status or fragment/length matches. Preserve strict-admission and safety deviations separately.
4. Implement only validated cells with TDD in the responsible package; unit tests use memfs/memory VFS and mocked capabilities, never native/LLM queries. Run the narrowest maintained checks covering the changed scope.
5. Verify byte/semantic views, authority denial, cancellation/accounting/cleanup, realm/checkpoint/replay, actual supported runtimes and installed public artifact independently. Mark unsupported and unexecuted cells individually; do not count them as passes.
6. Capture screenshots for new CLI visual output and review labels/readability. Temporary logs/evidence belong in `/out` and are purged after use; retain only durable receipts/specification in this plan.

Executed in this task: current-main inspection and immutable-source/hash inspection only. Native controls were supplied prior observations, not freshly run. No runtime tests were appropriate to this documentation-only change. Local commits: none; verified remote-main delivery: none; successful releases: none. No package publication was performed.
