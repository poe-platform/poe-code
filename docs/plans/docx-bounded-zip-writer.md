# DOCX bounded ZIP writer execution

Task: `shared-zip-write` only, 2026-09-14. Status: implemented and verified within
the bounded ZIP scope. Later tasks remain pending. The existing pipeline plan has
unrelated edits and is excluded from this commit; this record carries the owned
task update without replacing that work.

## Ownership and scope

Read root/scoped AGENTS, the DOCX and common Office CLI/SDK specifications,
`docs/docx/upstream-api-audit.md` and the parsed API/case inventories. Existing
shared ZIP/compression code and DOCX reader were reused. No TAR code moved.

Root owns `packages/docx/src/archive-write.ts`, `archive-write.test.ts`, the
context-validation extraction in `archive.ts`, `index.ts`, and this plan.
Assigned codec worker owns `packages/office-package/src/zip.ts` and `zip.test.ts`.
Assigned safe-bash reviewer owns additions to its existing
`tests/commands/zip.test.ts` and independently reviewed the new writer. The
reviewer's additional failing shared ownership regression was handed to the
codec owner for correction. Existing test names/assets remain intact. No new
safe-bash test file or integration-input membership is introduced.

## Implemented policy and language/security mapping

`writeArchive(archive, sink, options, context): Promise<void>` is an archive
infrastructure export, alongside `readArchive`. It is not a public document
model, pack command, OPC validator or filesystem transaction. Both eventual
command/model consumers must use this same engine. No new CLI grammar,
schema/capabilities support claim or root export is introduced.

| Surface | Exact contract |
| --- | --- |
| Input | `DocumentArchive` with readonly member array and owned `Uint8Array` payloads; all payloads snapshotted before first suspension |
| Ordering | Required `order: "name"` sorts exact names by Unicode code point; `"input"` preserves supplied array order |
| Compression | Required `compression: "store"` or `"deflate"`; directories stay stored; empty ordinary parts may be deflated |
| Metadata | Fixed UTC 1980-01-01, UTF-8 names, regular mode 0644/directory 0755, no comments or extra fields; source timestamps/comments deliberately normalized |
| Preservation | Exact uncompressed payload bytes, including binary and empty parts; compressed-byte identity is not promised |
| Sink | Supplied `write(Uint8Array, AbortSignal): Promise<void>` capability; every bounded detached chunk write awaited, no close/commit authority inferred |
| Invalid values | `InputTypeError`/`InvalidValueError`, code `usage`; options are closed and required |
| Container/limits | `InvalidContainerError` / `ResourceLimitError`, codes `invalid-container` / `limit-exceeded` |
| Output failure | `SinkError`, code `sink-failure`, fixed content-free message |
| Abort | `CancellationError`, code `cancelled`, after cooperative codec cleanup or awaited sink settlement |

There is no environment configuration, host pathname, ambient filesystem,
identity/time discovery, native compression fallback, product network or
reference runtime. The sink is a trusted capability, not a sandbox for host JS.
The writer validates and serializes the complete container before any sink call.
An output error or abort after output starts can leave a partial new stream;
the writer cannot roll it back. Conditional/staged filesystem publication and
its reporting remain the separately ordered publication task.

The shared codec retains legacy `auto` compression and permissive compressed
payload copying by default, including safe-bash's existing opaque-payload case.
An opt-in `validatePayloads` profile admits and snapshots all input bytes and
metadata before suspension, then validates actual serialized payload expansion,
CRC and trailing bytes before returning output. It rejects unsupported flags,
inconsistent sizes and retained ZIP64 extras that classic output cannot encode.
Classic output caps entries at 65,534 and sizes/offsets below 32-bit sentinels;
ZIP64 reading remains available through the existing DOCX reader.

The shared entry builder now accepts explicit `store`/`deflate` policies and
bounds compression output before retaining each chunk. Explicit deflate admits
raw bytes against expanded-entry/aggregate limits independently of the smaller
compressed-output ceiling. Portable codec loops retain bounded chunks and
cooperative yields. No synchronous native convenience codec was added.

DOCX reuses all explicit `ArchiveLimits`: output uses `maxArchiveBytes`, decoded
payloads use `maxEntryBytes`/`maxTotalBytes`, and member/name/depth limits bound
inventory work. No output extra/comment budget is consumed by normalization.
Serialized metadata is charged as 22 bytes plus 76 and twice each encoded name
length per member. Payload upper bounds are exact stored lengths or conservative
raw-deflate bounds `n + ceil(n/8) + ceil(n/64) + 32`; the admitted output bound is
the lesser of that total and the output/classic limits. Before payload copying,
retained admission reserves twice the decoded total, three output bounds, three
metadata totals, two capped chunks, and 1 MiB deflate or 64 KiB stored/validation
workspace. Actual aggregate compressed bytes are checked after every entry and
again during codec serialization. Shared strict snapshot byte copies are bounded
by serialized size. These are conservative owned-buffer bounds, not process RSS
isolation; caller-retained sink chunks are outside engine-owned memory.

## Inventory scope and documentation drift

The API inventory retains `Document.save`, `DocumentPart.save`, package `save`,
inherited members, collections, enums and underscore-named documented public
types. None is relabeled private or complete by this low-level writer. Their
existing neutral names and exact mappings remain authoritative: async save,
supplied byte/VFS capabilities, readonly zero-based sequences, explicit UTC
dates and typed stable errors. No blanket camelCase aliases are added.

The case map currently assigns eleven `tests/opc/test_pkgwriter.py` cases to
this task. Its first four are `it_can_write_a_package`,
`it_can_write_a_content_types_stream`, `it_can_write_a_pkg_rels_item`, and
`it_can_write_a_list_of_parts`. Byte inventory ordering/preservation is covered
here; content-type construction, relationship serialization and graph validation
remain pending under their later OPC tasks. The seven
`it_can_compose_content_types_element[xml_for_fixture0..6]` variants likewise
remain pending XML/OPC semantics. They must not be counted as passed from a ZIP
round trip. This corrects the task-assignment interpretation while preserving
the original research rows/evidence. No later task was implemented to satisfy
an overbroad generated mapping. Model `save` and common CLI `pack` parity remain
pending and must eventually select sorted/stored output for the specified pack
policy. The existing audit's historical “SDK implementation not started” remains
true of the document model, but no longer describes archive infrastructure.

## Failing-test-first evidence

- DOCX maintained tests: nine newly authored writer cases failed because
  `writeArchive` did not exist; all 62 existing cases passed. Implementation
  followed that red. Directory compression was corrected against the original
  failing expectation, without weakening its metadata policy.
- Shared codec: six regressions failed before their corresponding changes,
  covering explicit compression, actual size/CRC, writer ZIP64 metadata and
  abort during empty-entry cleanup. Existing flags checks remained passing.
- Independent review reproduced mutable filename metadata: strict output became
  `carbor` after caller mutation of admitted `harbor` bytes. The failing test
  preceded strict pre-suspension owned snapshots.
- A further DOCX regression failed when 4,096 compressible bytes were refused
  under a 256-byte output ceiling. A shared regression independently reproduced
  the same raw-versus-compressed admission defect before its correction.
- Tests additionally cover exact 22/101-byte archive boundaries, compression
  overflow before sink publication, detached sink buffers, UTF-8 code-point
  ordering, memfs destinations, delayed backpressure, output failure and abort.
  Shared tests exercise 1,024 ordered empty entries with an injected cooperative
  scheduler and reject member overflow without large host fixtures.

## Verification

Final maintained checks:

- `npm test --workspace=docx`: 73 passed, including all 62 original cases.
- `npm test --workspace=@poe-code/office-package`: 43 passed.
- `npm run build:workspaces -- --workspace=docx`: successful uncached shared
  codec and DOCX build closure derived from maintained declarations.
- `npm run lint --workspace=docx` and
  `npm run lint --workspace=@poe-code/office-package`: ESLint and strict
  production/test TypeScript checks passed. Initial type errors were corrected
  without weakening compiler options or test expectations.
- Final built safe-bash ZIP/unzip tests through its maintained
  `scripts/test-reporting.mjs --import tsx` runner: 122 passed. Its runner
  self-tests passed 500 cases; the maintained source/test compiler stage
  `node scripts/historical-type-models.mjs --noEmit` passed. Full safe-bash
  consumer/release gates were not run or claimed.
- `npm test --workspace=pptx`: all 6,874 tests passed across 269 files,
  checking the other shared codec consumer without changing it.
- Built ESM `import { writeArchive, readArchive, SinkError } from "docx"`:
  binary deflated sink round trip and stable error export passed without source
  aliases or filesystem mutation. `git diff --check` passed.
- Independent review confirmed the strict snapshot correction and final
  legacy behavior; no remaining defect identified within the reviewed scope.

The local atomic commit is identified in the delivery report. No push or release
is authorized. No CLI visual output changed; screenshots do not apply. No corpus,
native reference build, renderer, browser/worker or full document conformance
pass is claimed. Package README permission remains outstanding; this owned plan
records new usage and all options without editing a README.
