# qpdf pinned behavior contract

Task: `research-qpdf`. This is a research deliverable, not an implementation or a claim of qpdf parity. [Acceptance gates](safe-bash-qpdf-acceptance.md) and [independent compatibility controls](compatibility-qpdf.md) are separate documents. No gate closes merely because native qpdf accepts a small fixture.

## Current-main inspection and provenance

Inspected local `main` at `ab1fa8d34101e1e7f61272973f3bc28a842043d8` on 2026-09-21. `git ls-tree -r --name-only HEAD packages scripts` contains no qpdf implementation/package/test. Focused searches of safe-bash command source and package exports also found none in the working tree. `safe-bash-qpdf.md` has research, engine, behavior, command, safety, compatibility and shipping tasks open. Absence of implementation is concrete evidence, not a failing runtime regression. No speculative runtime repair or empty package is appropriate for this task. Unrelated edits are preserved.

Pin: qpdf commit **54d6053af283bbeb8b325f4886c0f65cc51f2b80**, reporting **12.4.2**. This is a source snapshot, not an official released 12.4.2 artifact; supplied GitHub metadata observed 12.4.1 as latest. Archive URL: `https://codeload.github.com/qpdf/qpdf/tar.gz/54d6053af283bbeb8b325f4886c0f65cc51f2b80`. SHA256 **72d7ec2ae6a3136adfcda23cc784118ed72a83de9085fa2dddb6a76e81fb6496**, freshly downloaded and verified this session. No fresh native build or native invocation is claimed. Supplied research build used CMake 4.4.3/OpenSSL/JPEG; host builds are research-only.

Evidence classes: **fresh source** = inspected this session; **supplied native** = executed controls reported in the task and existing plan, without their original capture files; **open** = unexecuted or insufficiently captured qualification. Full byte goldens cannot be recovered from summaries, object numbers, lengths or catalog-key presence. Root `/out` is read-only; temporary source evidence used repository `out/research-qpdf` and was purged after review.

Source links below resolve under [the immutable upstream tree](https://github.com/qpdf/qpdf/tree/54d6053af283bbeb8b325f4886c0f65cc51f2b80).

| Source | Responsibility / fresh inspection anchors |
| --- | --- |
| `manual/cli.rst` | Versioned syntax, modes, ranges, stream transformations and split-document limits |
| `libqpdf/QPDFJob.cc` | `checkConfiguration` (560), `getExitCode` (528), object selection (926), collation (2545), page ownership/publication |
| `libqpdf/QPDFJob_argv.cc` | Scoped argument tables; positional/dashed encryption cannot mix; pages file/range/password ownership |
| `libqpdf/QPDFJob_json.cc` | Job schema validation (640); separate from document JSON |
| `libqpdf/QPDFWriter.cc` | `Config::stream_data` (576), `will_filter_stream` (1548), `generateID` (2055); graph enqueue, QDF/version setup, serializer/two-pass write |
| `libqpdf/QPDF_pages.cc` | Page inheritance whitelist (351), tree flattening, resources/rotation/forms |
| `libqpdf/QPDF_linearization.cc` | Hint offsets/lengths, range/bit-table validation; presence of a dictionary is insufficient |
| `libqpdf/QUtil.cc`, `QPDF_json.cc`, `QPDF_encryption.cc` | Range lexical grammar, selected-object output and R5/R6/password behavior; supplemental source owners |

## Syntax, modes and exact interactions

Basic forms: `qpdf [options] input.pdf output.pdf`; `qpdf --empty [options] output.pdf`; `qpdf input.pdf --check`; `qpdf input.pdf --show-xref`; `qpdf input.pdf --show-object=obj[,gen]`; `qpdf input.pdf --json[=version] [output.json]`. Input `-` is not stdin. Output `-` is admitted only by appropriate output modes. Ordinary inspection modes reject output arguments; JSON defaults to stdout. Raw/filtered stream inspection sends binary stdout without an invented LF. `--check` checks structural syntax, not rendering, text, navigation, signature or security fidelity.

General status: clean 0, error 2, warnings 3, 1 unused. `--no-warn` suppresses diagnostics but retains 3; `--warning-exit-0` changes warning status to 0 and retains warnings. Predicate status overrides ordinary warning mapping: `--is-encrypted` 0 encrypted/2 not; `--requires-password` 0 missing or wrong password/2 unencrypted/3 accepted password. Predicates cannot combine. Silent means stdout; damaged predicate input can emit recovery stderr even with exit 2.

Same input/output identity is rejected except `--replace-input`, which conflicts with explicit output, split, JSON and empty. Native replacement uses `.~qpdf-temp#`, with `.~qpdf-orig` backup on warnings. VFS replacement needs exclusive staging, identity-aware conditional publication and safe backup collision handling. Split stdout rejects. Native sequential split writes and JSON sidecars can leave completed/overwritten files after later failure; product must preflight/stage and document its actual multi-file commit boundary rather than promise an unsupported transaction.

Scoped examples:

- `qpdf input.pdf --pages . 1-3 other.pdf --password=secret 4-z -- output.pdf`
- `qpdf input.pdf --pages . --range=3-1 -- output.pdf`
- `qpdf --empty --pages first.pdf 1-z second.pdf 1-z -- merged.pdf`
- `qpdf input.pdf --overlay overlay.pdf --from=1-z --to=1-z --repeat=1 -- output.pdf` (underlay same scope; overlap/repetition effects open).
- `qpdf input.pdf --encrypt user owner 256 [permission-options] -- encrypted.pdf`; dashed encryption alternatives are a separate scoped grammar and cannot mix with positional alternatives.
- `qpdf input.pdf --add-attachment payload.bin --key=K --filename=Résumé.bin --description='Binary sample' --creationdate=D:20240102030405Z --moddate=D:20240102030405Z -- output.pdf`
- `qpdf input.pdf --copy-attachments-from other.pdf --prefix=P -- output.pdf`

`--` closes the active pages/overlay/underlay/encryption/attachment scope, not every scope at once. Missing terminators, filename-looking ranges, omitted ranges, scoped passwords, repeated options, `@argument-file` tokenization and exact stderr need separate controls. VFS-only argument/password/job/document JSON files cannot authorize ambient host reads.

## Ranges, collation and page ownership

Range grammar: optional exclusion `x`; endpoint decimal N, reverse `rN`, or `z`; optional `-endpoint`; comma-separated groups; optional exact final `:odd`/`:even`. 1-based, bounded native integers; leading zero decimals accepted. No whitespace/signs/uppercase suffix. `z=Npages`; `rN=Npages+1-N`. Validate endpoints before expansion and charge repeated entries/exclusion work before materialization. Descending ranges and repetitions preserve order.

Exclusions affect only the most recent inclusion group; consecutive exclusions keep modifying that group. Parity uses positions in the final list, not page numbers. Supplied eight-page controls:

| Range | Ordered page markers |
| --- | --- |
| `3-1`; `r1`; `z`; `r3-r1` | 3,2,1; 8; 8; 6,7,8 |
| `1,1,2`; `2,4,6,8:odd` | 1,1,2; 2,6 |
| `1-4,x2,2-5` | 1,3,4,2,3,4,5 |
| `1-4,5-8,x2`; `1-4,x2,x3`; `1,1,x1` | 1..8; 1,4; 1 |
| `8-1:odd`; `8-1:even`; `1-8,x2-7:even` | 8,6,4,2; 7,5,3,1; 8 |
| Entire inclusion excluded | Empty PDF, status 0 |
| First exclusion, empty group, bad suffix, 0/9/r0/r9/overflow | Status 2, no output; exact diagnostics open |

For selections `1-4` and `8-5`: bare collate -> 1,8,2,7,3,6,4,5; `--collate=2` -> 1,2,8,7,3,4,6,5; `--collate=2,1` -> 1,2,8,3,4,7,6,5. Zero/one/one-per-selection values allowed; negative/wrong arity fails 2 before output. `01` accepted. All-zero values fall back to concatenation; mixed zero values silently drop those selections, status 0/no warning. Product policy: **reject zero collate values explicitly**, a deliberate safety deviation, pending implementation. Unequal lengths/multi-input/foreign graph collisions remain open.

Only MediaBox/CropBox/Resources/Rotate inherit, nearest ancestor with own-key override. Shared direct nonscalars become indirect; tree flattening is cycle-checked. Unknown intermediate Pages keys are discarded with warning; root Pages unknown keys retained. Duplicate pages are shallow copies; foreign/duplicate AcroForm annotations are repaired where possible, with repair exceptions warning. Removed primary pages may become null even while catalog navigation references them. Default writer enqueues trailer-reachable graph, not every historical/unreachable object. `--preserve-unreferenced` additionally enqueues all objects. Preserve unknown retained graph/raw streams/aliasing; do not claim unconditional byte preservation.

| Feature | Plain rewrite / primary page selection | Empty import / split |
| --- | --- | --- |
| Info, synthetic XML Metadata, custom catalog keys, attachment/name tree | Supplied preserved; removed-page outline destination can be stale without warning | Supplied dropped |
| Outlines/named destinations | Keys retained does not prove destinations valid; duplicate page destination resolved first retained instance in supplied control | Generally not imported/preserved |
| Page labels | Selected-source labels rebuilt, including repeats/order | Imported; split labels rebased |
| Real XMP, threads, tagged structure, full AcroForm/appearances, signatures | **Open independently** | **Open independently**; no merge/preservation promise |

Four-page supplied metadata control: inherited 72×144 box/resources, ResearchPage1..4, Title original-title/Author research/custom ResearchInfo, ResearchRoot, `<root/>` XML, outline targets 1/4, note.txt `hello`, destination to page2, labels index0 roman/front- and index2 decimal starting5. Selection 1,2 retains both outline entries but removed page4 resolves nowhere. Empty import retains only pages/labels among enumerated features. Split2 produces split-1-2.pdf/split-3-4.pdf and rebases labels to roman1/decimal5. Selection4,1,1 labels decimal6/front-roman1/front-roman1; original page1 outline resolves outputposition2. Six operations status0/no diagnostics; seven outputs inspected. This is supplied semantic evidence, not reconstructible byte goldens.

Split filenames: first `%d` substituted; otherwise range inserted before case-insensitive final `.pdf`, else dash/range appended. Width = digits in selected page count; ranges are output positions. Filename collision/identity and all output-count budgets must be validated before publication.

## Writer, compression, transformations and crypto

Object streams `preserve|disable|generate`; decoding `none|generalized|specialized|all`. Generalized includes LZW/Flate/ASCII85/ASCIIHex; specialized adds RunLength; all adds DCT. Other filters remain raw, never silently drop unsupported bytes. Default compress-streams=y/generalized does **not** recompress an unmodified single `/FlateDecode` or `/Fl` stream: fresh `will_filter_stream` source and manual contradict the supplied blanket recompression claim. `--recompress-flate` overrides this optimization. Modified streams/filter arrays/root metadata/normalized content/empty streams need separate controls. This correction does not close compression qualification.

`--stream-data=preserve` sets none/compressfalse; uncompress raises decode to at least generalized/compressfalse; compress raises it to at least generalized/compresstrue. Explicit option order matters. Compression level 1..9; existing Flate requires recompress-flate to change compression. New compressed bytes are not assumed identical across implementations.

QDF requires non-linearized/non-PCLm config; defaults normalizationtrue/compressfalse/generalized unless explicit, disables preserved encryption, but explicit encryption still applies. Normalization/PCLm disables preserved encryption. Forced version <1.5 disables object streams and may disable incompatible crypto. Supplied forced1.4 control disabled generated object streams and AES256. CLI `--qdf --linearize` succeeded; reverse order failed2 after partial output. **Product preflights incompatible QDF/linearize settings and publishes only complete outputs**, deliberately diverging from order-dependent corrupt/partial effects.

First /ID retained when available; second regenerated even static-id. Without first ID, generated second supplies first. Deterministic IDs exclude filename, use content digest/string Info, reject encrypted output. Ordinary IDs use current time/output filename/Info: explicit clock/random capabilities required. Static AES IV is fixture-only and intentionally rejected in production. Linearization needs two passes, equal-length zero IDs first pass, valid hint lengths and adjusted xref offsets, plus actual range-reader qualification.

Rotation `--rotate=[+|-]angle[:range]` defaults all pages: absolute replaces inherited rotation; signed adjusts it, modulo360. Manual lists0/90/180/270; source accepts multiples90 modulo360. Exact lexical/order/repeated-range behavior remains open. Flatten rotation, overlay/underlay, normalization, coalescing, image optimization/externalization, annotation flattening/appearance generation and resource cleanup each have separate gates, not implied by rotation or parser success.

Encryption/decryption gates separate R2/R3/R4/R5/R6, RC4/AES, user/owner, permissions, crypt filters/metadata, copy encryption, password encodings and recovery. bytes/hex-bytes/unicode/auto differ; older revisions convert Unicode to PDFDocEncoding and reject unencodable explicit Unicode. Native recovery can retry QPDFExc, not just password errors. Product recovery must never retry quota/structural/cancellation failures. Embedded-NUL C-string behavior, UTF8 preparation and 127-byte truncation/multibyte boundaries remain open.

Supplied PDF.js primitive pin579c4b700f23f7782234f03358b5e9eaa3f58889: 18 R5/R6 controls matched independent Node SHA256/384/512 and AES128-CBC/no-padding. Lengths0,1,7,16,31,32,63,126,127 × owner-user length0/48; password[i]=(29*i+length)%256; salt=[0,1,2,3,252,253,254,255]; owner-user[i]=(11*i)%256. R5 hashes password||salt||user. R6 starts there, repeats password||digest||user64 times, AES key first16/IV next16, first16 ciphertext big-endian modulo3 picks hash, returns first32 digest. At least64 rounds, stop when last ciphertext byte<=round-32; must finish by287. Observed64..90. Budget buffers/AES/hash per attempt and cancellation between rounds. These are primitive controls only; separately reported unaligned AES chunk-invariance failure remains unresolved, and no full crypto/writer gate closes. No production native/WASM/package fallback is authorized.

## JSON and attachments

Document JSON versions1/2; latest=2; 0/3 fail2. `qpdf` key onlyv2; `objects`/`objectinfo` onlyv1. Job JSON schema is independently version1. `--json-output` defaults decode-none/inline, requiresv2 and includes qpdf even with selected pages key. `--json` defaults generalized decoding and stream-data none; json-output switches to decode-none/inline. Both can be overridden; test these defaults separately. none omits stream data; inline base64; file mode to stdout needs explicit prefix. Named output named.json produces named.json and named.json-object sidecars; native overwrites a sentinel sidecar. Product must preflight identities/collisions. Small json-output/json-input/--check round trip proved only structure, not render/text/signature fidelity.

Selectors are sets, not ordered duplicates. Native prefix conversion accepts malformed suffixes; abc/0/empty v1 selectnone, v2 accidentally selectall+trailer through empty wanted-set sentinel. -1 selectsnone; 32/64-bit overflow rejects2. Product requires exact bounded obj[,gen] or trailer syntax and distinct all/none representations; malformed/empty reject, **CLI0 intentionally rejects** to avoid ambiguous whole-document disclosure. This is a specified safety deviation. qpdf/objects-only inspection avoids page extraction repairing the tree before export. JSON update/schema/base64/file-reference budgets remain open.

Supplied attachment hex `00010a0dff6174746163686d656e74` reconstructs exactly **15 bytes**; fresh independent Python length/MD5 calculation confirms checksum **1c33c71829f038ba8c9144f34493ac5c**. Supplied keyK, Résumé.bin, Binary sample, timestamp D:20240102030405Z; list `K -> 10,0\n` is writer/fixture-specific, not universal key identity. Native extraction itself has not been freshly rerun. Native missing show/remove: status2, empty stdout/no output; duplicate add/copy:2/nooutput; replace overwrites key; prefixP yieldsPK; empty key falls back to filename; invalid timestamp2 before output. Embedded bytes/names/Unicode/dates/MIME/name-tree ordering require independent goldens.

Remove-info supplied drops Info except ModDate; source also removes catalog Metadata. Remove-metadata/structure/acroform controls exercised absent keys only: no-op admission, not removal qualification. Source remove-structure erases StructTreeRoot AND MarkInfo; remove-acroform only catalog AcroForm, may leave widget annotations/objects. None is a redaction claim or erasure from previous revisions/backups.

## Product handoff

Follow [the relocated package pattern](archive/safe-bash-command-package-pattern.md), originally `docs/plans/safe-bash-command-package-pattern.md`. Future implementation owns `packages/safe-bash-command-qpdf`, name `safe-bash-command-qpdf`, private:true, TypeScript ESM, zero external runtime dependencies. Safe-bash only composes/exports opt-in `@poe-platform/safe-bash/commands/qpdf`. No package publication is authorized. Do not implement algorithms in composition exports or add proxy-only functions.

Inspect maintained owners during integration: `packages/safe-bash/scripts/build.mjs`, `integration-boundaries.json`, `scripts/integration-inputs.mjs`, `scripts/build-workspaces.mjs`, `scripts/bundle-safe-bash.mjs`, `scripts/package-safe.mjs`, `scripts/safe-command-publication.mjs` and package-lint. Current unrelated changes are not evidence of qpdf integration. First-party dependency DAG contracts/engines→command→safe-bash, no return edge. Bundle implementation/declarations with no unpublished specifier; preserve canonical runtime brands/error constructors across root/contracts/command subpaths. Prove actual installed consumers without workspace source.

CLI/SDK share grammar, bytes, engine, statuses, budgets, cancellation and effects. VFS only; no host process, ambient file, implicit network, native/WASM fallback or downloads. Preserve paired canonical byte-argv/context identity, realm ownership and replay lifetime. Register idempotent cleanup before acquisition, await backpressure/cleanup, rollback reservations on all thrown values. Explicit quotas cover input/output/retained bytes, objects/xrefs/revisions, recursion/filter depth/decoded bytes, range/exclusion work, pages/resources/import maps, crypto rounds/retries, JSON nodes/base64/sidecars, outputs/attachments and linearization passes. `--no-default-limits` cannot disable mandatory budgets. No optional unsupported capability gets counted as a pass.
