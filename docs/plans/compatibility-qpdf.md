# Independent qpdf compatibility controls

Execute this Markdown QA with an agent, not a product script or unit-test host process. Contract: [research](safe-bash-qpdf-research.md); acceptance: [gates](safe-bash-qpdf-acceptance.md). Candidate implementation is absent at inspected main; **all candidate comparisons remain OPEN**. Original native observations supplied by the task are not freshly rerun here. This session verified the source archive hash, reviewed source, and independently reconstructed attachment length/MD5 only.

## Oracle and record discipline

1. Acquire the immutable qpdf source archive/revision/hash from the research contract. Verify before building; record compiler, CMake, OpenSSL/JPEG/zlib versions, platform, build flags and `qpdf --version`. A version string alone does not identify this snapshot. Isolate host oracle from the product. Do not add native tools/dependencies/downloads to runtime or unit tests.
2. Build an isolated research-only oracle. Native fixtures/captures and source belong in `/out`; if unavailable, record the read-only limitation and use repository `out/research-qpdf`, then purge generated evidence after transferring reviewed findings. Keep this QA in docs/plans.
3. Record candidate commit, dirty candidate files, maintained build/check commands and actual installed artifact identity. Ensure CLI/SDK point to identical candidate source. No candidate exists yet: mark comparisons OPEN, not skipped/pass.
4. For every invocation record argv as separate tokens/byte spellings, cwd, LC_ALL=C/TZ=UTC, explicit clock/random policy, VFS starting identities/permissions/bytes, full stdout/stderr bytes (escaped text plus hex for binary), status, output filenames/identities/digests, backups/stages, warning routing, and remaining effects on failure. Pin complete fixture bytes/hash and licenses. Supplied descriptions alone are not golden byte fixtures.
5. Derive oracle captures independently before engine implementation. Store reviewed full byte goldens in the eventual responsible package's fixture/snapshot corpus, never generate them using the candidate serializer/parser. Unit tests construct memory VFS/memfs, mock capabilities, and never create ordinary disk files, spawn qpdf or query an LLM. Manual QA native outputs can use research disk.
6. Execute every O001–O140 named-option gate plus every G01–G60 subcell; capture versions/defaults/scopes, malformed forms and interactions. R options compare the explicit product failure contract rather than fake native parity. Explain deliberate deviations: zero collation, malformed/zero JSON selectors, static AES IV, limits/host/debug options, QDF/linearize preflight and staged publication.
7. On every admitted generated PDF run oracle --check, inspect graph via an independent parser, and qualify rendering/text/navigation/attachments as applicable. Inspect representative transformed-page screenshots; parse success or file existence after failure cannot prove success. Linearization additionally needs independent actual byte-range-reader/hint checks. Keep performance timing separate from semantic acceptance.
8. Minimize mismatches into independent fixtures; add fast failing memory tests before repairs. Account cancellation/work/retained bytes and cleanup through denied/failing/backpressured VFS sinks, simultaneous identity changes, alias/collision/permissions and replay/realm boundaries. Qualify actual publication behavior, never infer multi-file atomicity.
9. Finally install the actual packed safe-bash artifact without command workspace source. Import commands/qpdf/runtime/types in every advertised profile; verify no external runtime/unpublished specifiers, canonical brand/error identity, Shell-created invalid-byte argv, CLI/SDK equivalence and explicit unsupported behavior. Do not publish the private command package.

## Supplied native evidence ledger

These batches constrain expected behavior; original per-call captures are not available. Do not sum observations as unique supported features or count the 18 PDF.js controls as qpdf file controls.

| Evidence ID | Reported executions | Fixture / proof limit |
| --- | --- | --- |
| N82 | 82 original qpdf fixture controls | Eight-page classic-xref, inherited boxes/rotation, Info/custom trailer/orphan; AES256 derivative; damaged startxref/unknown/empty/missing. No complete byte goldens supplied. |
| N49 | 49 further range/collation invocations | Eight-page ResearchPage1..8, independently ordered/marked using qpdf JSON; broader multi-source resource cases open. |
| N6 | Six metadata operations, seven output inspections | Four-page catalog fixture described in research; XML is synthetic, not real XMP; stale destinations observed. |
| P18 | 18 PDF.js R5/R6 primitive controls | Independent Node crypto reference; not end-to-end qpdf encryption/writer proof; upstream chunk defect not waived. |
| N83 | 83 JSON/attachment observations | 52 operations +30 selector cells +1 sidecar sentinel; three-page1236-byte original Poppler fixture; no original PDF bytes supplied here. |
| S140 | 140 named native help entries | Names only, not grammar/default/effect qualification. |

## Fixture admission

| Fixture | Construction / independent variants | Missing evidence |
| --- | --- | --- |
| F8 | Eight classic-xref pages with ResearchPage1..8, inherited boxes/resources/Rotate, Info, custom trailer and orphan-secret | Exact original bytes/offsets/hash; use a fresh independently authored valid PDF and derive a new hash rather than impersonate original |
| F4 | Four pages72×144, full catalog/labels/outline/name-tree/embedded hello fixture in research | Exact bytes/hash; real XMP/threads/tagged/forms/signatures additionally required |
| F3 | Original1236-byte Poppler text fixture: Helvetica12, Hello world/alpha beta, hyphen-/ation/column two, rotated empty third,216×144, Info/customOdd | Exact bytes/hash; descriptions/lengths insufficient for render/text or numbering goldens |
| FA |15 exact bytes00010a0dff6174746163686d656e74; keyK/display Résumé.bin, Binary sample, explicit D:20240102030405Z | Bytes/MD5 freshly reconstructible; native embedded-file output pending fresh rerun |
| FE | Separate native encrypted derivatives across R2..R6/user/owner/filter/permissions/metadata | Retain RNG/ID policy; native static AES IV permitted for oracle fixtures only; full corpus open |
| FD | Damaged startxref plus cycles/dangling refs/duplicate xrefs/length mismatch/filter bombs | Exact damage mutation/bytes required; exercise recovery vs suppress-recovery and all limits |
| FG | Object/stream/hybrid xrefs, incremental generations, aliased and unknown reachable/unreachable objects | Original graph and serializer conservation controls, not only page count |
| FM | Real XMP, outlines/destinations, forms/appearances/signatures/threads/tagged structures and attachments | Distinct primary/import/split preservation/removal outcomes and expected warnings |
| FL | Nontrivial multi-page linearization with shared resources/objects/large hints | Valid two-pass offsets/hints, actual range reads, object streams/version/crypto combinations |

## Expected native stdout/stderr/status/effects

`""` means known empty bytes. **Capture open** means the full stream was not supplied; do not replace it with an invented diagnostic or accept a substring as byte compatibility. Paths/object numbers/writer versions affect outputs. argv omit the executable only; fixture names denote independent admitted originals/derivatives.

| Control / argv | Expected stdout | Expected stderr | Status / effects |
| --- | --- | --- | --- |
| `encrypted.pdf --is-encrypted` | `""` | `""` for clean fixture |0; no output file |
| `input.pdf --is-encrypted` | `""` | `""` for clean fixture |2; no output file |
| `encrypted.pdf --requires-password` / wrong password | `""` | `""` clean |0; no output file |
| `encrypted.pdf --password=CORRECT --requires-password` | `""` | `""` clean |3 accepted password, not warning; no file |
| `input.pdf --requires-password` | `""` | `""` clean |2 |
| `damaged.pdf --check` | Full check report capture open | Recovery-warning capture open |3 |
| `damaged.pdf --check --no-warn` | Check report capture open | `""` |3 |
| `damaged.pdf --check --warning-exit-0` | Check report capture open | Same warnings, capture open |0 |
| Damaged predicates | `""` | Can warn; capture open | Predicate exit2 can coexist with warnings |
| `input.pdf --pages . --range=R -- output.pdf` | `""` successful supplied controls | `""` successful controls |0; exact order in research table; output must --check |
| Invalid ranges/negative or wrong-arity collate | `""` | Exact errors capture open |2; no output |
| Zero/mixed-zero native collate | `""` | `""` |0; all-zero concatenates, mixed-zero drops source; product rejects |
| `--empty --pages input.pdf 1,2 -- output.pdf` | `""` | `""` supplied metadata control |0; pages/labels only among enumerated metadata |
| `input.pdf --split-pages=2 split.pdf` (F4) | `""` | `""` |0; split-1-2.pdf/split-3-4.pdf; labels rebase, enumerated metadata dropped |
| `encrypted.pdf --qdf output.pdf` | Full capture open | Full capture open |0 supplied, output decrypted; broader explicit encrypt interaction open |
| Forced1.4/generated streams/AES256 | Full capture open | Full capture open |0 supplied; no object streams/incompatible encryption |
| Deterministic-id encrypted output | Full capture open | Exact error capture open |2 |
| `input.pdf --qdf --linearize output.pdf` | Full capture open | Full capture open |0 supplied; output structurally qualify |
| `input.pdf --linearize --qdf output.pdf` | Full capture open | Exact error capture open |2; native partial output, product preflight rejects before publication |
| Default / preserve-unreferenced rewrite | Full capture open | Full capture open |0; orphan-secret absent/present respectively |
| `attached.pdf --list-attachments` | `K -> 10,0\n` for supplied numbering | `""` supplied |0; numbering not generalizable |
| `attached.pdf --show-attachment=K` | Exact15 bytes FA; no LF appended | `""` supplied |0 |
| Missing attachment show/remove; duplicate add/copy | `""` | Exact error capture open |2; no output file |
| Replace attachment / copy prefixP | Full captures open | Full captures open |0; replacesK / keyPK |
| Invalid PDF attachment timestamp | `""` | Exact error capture open |2 before output |
| JSON latest/2 /1 | Exact serialized bytes capture open | `""` valid supplied controls |0; v1 differs; latest equivalent2 |
| JSON0/3, output1, wrong key/version | `""` | Exact error capture open |2 |
| JSON file streams stdout, no prefix | `""` | Exact error capture open |2 |
| JSON file streams prefixstream | JSON bytes capture open | `""` supplied |0; stream-7/8/9 in F3 supplied numbering |
| JSON named output named.json | No stdout expected; full capture open | `""` supplied |0; named.json + named.json-7/8/9; existing sidecar sentinel overwritten by native |
| JSON output→input→PDF then --check | Serialized/check captures open | `""` supplied |0 structural roundtrip only |
| remove-info | Full captures open | `""` supplied |0; retains ModDate in supplied fixture; source removes catalog Metadata |
| remove-metadata/structure/acroform absent-key controls | Full captures open | `""` supplied |0; only no-op admission qualified |
| --show-xref / --show-object / --check-linearization | Complete goldens OPEN | Complete goldens OPEN |Independent original fixtures/status still required |

Selector corpus crosses json1/json2 with `abc`, `0`, `-1`, `1tail`, `+1`, leading-space1, `1,`, `1,garbage`, `1,0tail`, `1,1`, `2147483648`, 24 nines, `trailer`, `1,0,2`, empty. Native prefix conversions accept suffixes selecting1,0; unknown generation1,1 selectsnone; abc/0/empty v1 none versus v2 all+trailer, status0. Overflow32/64 errors2. Native valid-but-unusual spellings need original full JSON goldens; product exact grammar and documented zero rejection must not disclose all objects accidentally. Existing native serializer quirks do not authorize unrestricted JS numeric conversion.

Every uncaptured stdout/stderr, fixture hash, unsupported preservation claim and unexecuted interaction remains OPEN. Keep source conclusions separate from executed file evidence and native support separate from product acceptance.

## Current-checkout execution receipt, 2026-09-21

Manual execution of candidate admission steps 3 and 9 at HEAD
`ab1fa8d34101e1e7f61272973f3bc28a842043d8`, with existing unrelated working-tree
edits preserved. This identifies the inspected checkout, not an implemented or
installed qpdf candidate. Runtime: Node `v22.22.2`, npm `10.9.7`, zsh on macOS.
No command implementation files were changed during this audit.

| Check | Observed result | Qualification consequence |
| --- | --- | --- |
| Command manifest/source | `packages/safe-bash-command-qpdf` does not exist | Package name/privacy/ESM/dependencies and actual command behavior cannot be verified |
| Composition facade | `packages/safe-bash/src/commands/qpdf/index.ts` does not exist | No CLI/SDK candidate to compare |
| Parsed safe-bash manifest | `exports["./commands/qpdf"]` absent; no qpdf dependency | Installed runtime/declaration export unavailable |
| Packed-consumer coverage search | No qpdf matches in `scripts/fixtures`, `scripts/bundle-safe-bash.mjs`, `scripts/package-safe.mjs` or safe-bash source | No qpdf installed-artifact qualification executed |
| Named-option ledger | 140 rows: 131 U, 9 R, zero supported | Inventory is complete as names; proposed failures are not observed candidate diagnostics |
| Native control tools | `command -v` finds none of qpdf/pdfinfo/pdftotext/pdftoppm on PATH | No fresh native check, parser/text control or page render executed |
| Existing PDF serializer | `packages/pdf/src/serialization.ts` imports pdf-lib; rejects Encrypt/ID and noncontiguous/nonzero-generation identities; trailer serialization includes Root/Info only | Cannot substitute this renderer writer for a qualified zero-external-dependency qpdf graph writer |

The option-ledger file's SHA256 at inspection was
`8523b947425f035e6f5cc80999971ed49ac0f9fee7613969a5de95236c865acf`.
The requested package-pattern file is absent at its original path in existing
edits; its available [archived counterpart](archive/safe-bash-command-package-pattern.md)
was read. It explicitly requires an actual handler rather than an empty scaffold.

Exact fixture set executed against a candidate: **empty**. Candidate stdout,
stderr, exit codes, PDF bytes, VFS effects, transformed screenshots and differences
are **unobserved**, not empty or matching. Supplied N82/N49/N6/P18/N83/S140
observations retain their earlier provenance and were not rerun. No minimized
candidate failure exists from which to add a regression or justify a repair.

O001–O140 and G01–G60 remain OPEN, including forms/outlines/attachments/tagged
structures, inheritance, encryption, linearization, damaged-file recovery,
renderer/text preservation, realm/host authority, cancellation, budgets,
rollback/cleanup and original/checkpoint/replay execution. Syntax/runtime/lint,
CLI/SDK and installed declaration gates cannot run for an absent workspace;
they are unavailable, not passing tests. Broad repository checks were not run
for this documentation-only receipt. No performance measurements were taken.

Qualification remains incomplete until a real first-party parser/writer and
command candidate exist. Native-only reruns cannot close that gap. No command
package was published; no local commit, remote-main delivery or release was
performed by this audit.
