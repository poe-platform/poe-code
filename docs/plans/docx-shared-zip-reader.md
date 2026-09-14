# DOCX shared ZIP reader execution

Task: `shared-zip-read` only. Date: 2026-09-14.
Status: implemented and verified. The local commit is identified in the delivery report.
All subsequent pipeline tasks remain pending. The existing pipeline file contains
unrelated edits and is intentionally excluded from this task's staging inventory.

## Inspected baseline and ownership

Read root/scoped AGENTS, `docs/specs/docx.md`, `office-cli.md`, `office-sdk.md`,
`docs/docx/upstream-api-audit.md` and the API inventory. The audit already records
explicit language/security decisions and documentation-error dispositions; those
model APIs remain planned, including inherited/underscore-named public members.
No whole-model implementation or coverage claim follows from this ZIP task.

`packages/zip` is absent. `packages/docx` contained original assertion/fixture
suites and its standalone legal notice, but no product source or manifest.
`@poe-code/office-package` already exposes portable ZIP and compression codecs;
safe-bash's `archive/zip-format.ts` is already a thin public-codec adapter.
Its compression remains low-level incremental raw inflate/deflate with bounded
input/output work and cooperative yields. No extraction or new ZIP implementation
was necessary. Existing `safe-fs/src/xml.ts` and `pptx/src/xml.ts` were inspected;
XML implementation/admission is a later task and was not duplicated or imported.

Root owns the DOCX package, its explicit lockfile entries, README draft and this
execution record. Assigned leaf `/root/archive_review` independently reviewed
safe-bash behavior and guarded inputs, then the new reader. It made no edits.
No safe-bash source/test or guarded input membership changed. Its exact archive
compatibility profiles, colon/backslash POSIX names, duplicate policy and local
DOS date interpretation remain intact.

Owned commit inventory:

- `packages/docx/package.json`, `tsconfig.json`, `tsconfig.test.json`, `LICENSE`
- `packages/docx/src/archive.ts`, `archive.test.ts`, `index.ts`
- `packages/docx/tests/assertions.ts`, `assertions.test.ts`, `fixtures/documents.test.ts`
- `package-lock.json` (only the new workspace/link declarations)
- `docs/docx/package-readme-draft.md`
- `docs/plans/docx-shared-zip-reader.md`

Original test names, inputs and assertions are preserved. Existing test/helper
changes are tuple/non-null annotations and an equivalent indexed XOR expression
needed to pass newly maintained `noUncheckedIndexedAccess` checks. No fixtures
were downloaded, generated on the host by unit tests, or copied from a reference
runtime. Mutation tests use memfs; ZIP byte mutations are original in-memory data.
Historical records and unrelated work remain untouched.

## Implemented boundary

The private `docx` ESM workspace exports `readArchive(bytes, context)`, returning
an always-async `DocumentArchive` with ordered members and an owned comment.
It reuses `createZipCodec` with ZIP64, duplicate rejection and UTC DOS dates.
Every payload is fully decoded and checked before any result is returned.
Document-only admission rejects backslashes, colons and symlinks without changing
shell ZIP semantics. Shared admission covers local/central framing, spans,
methods, flags, ZIP64, descriptors, path traversal, duplicate effective names,
CRC, trailing compressed data, declared sizes and actual expansion.

All limits and cancellation are explicit. Input and limits are owned before the
first suspension. Buffer subclasses are copied by the shared reader. Returned
member buffers do not alias each other or input. Allocation is preflighted using
four input lengths, two capped processing chunks, 64 KiB fixed decoder workspace,
and aggregate expansion. The fixed allowance covers the inspected raw inflate
32 KiB window, code tables and typed scratch; no gzip headers are decoded here.
This is conservative byte admission, not process RSS isolation. Metadata budgets
may be zero; nonzero capacities remain positive safe integers. Unknown limits
and invalid inputs fail before byte parsing. No ambient filesystem, native
process/compression fallback, host identity/time lookup or product networking is
introduced. The only product dependency is the existing private shared codec.

JS/security mappings for this boundary:

| Surface | Exact disposition |
| --- | --- |
| Archive input | `Uint8Array`; arbitrary host paths/streams are not accepted by this byte-only layer |
| Read | Always `Promise<DocumentArchive>`; no sync/value-dependent overload |
| Member collection | Central-directory order, ordinary readonly array type; normal zero-based JS sequence |
| Member payload/comment | Owned mutable `Uint8Array`, never text-reconstructed |
| Timestamp | UTC `Date` decoded from admitted archive metadata, never current time |
| Invalid input/type | `InputTypeError extends TypeError`, code `usage` |
| Invalid limits | `InvalidValueError extends RangeError`, code `usage` |
| Container/CRC failure | `InvalidContainerError`, code `invalid-container` |
| Actual configured bound | `ResourceLimitError`, code `limit-exceeded` |
| Cancellation | `CancellationError`, code `cancelled`, after codec cleanup |

These are infrastructure exports for the future common engine, not a second
CLI operation grammar or a competing model. No commands, root public exports,
schema/capabilities claims or public model methods are introduced. Existing
neutral model spellings and mapped documentation corrections remain authoritative.
OPC URI/case/percent aliases, relationships, XML, model creation and deterministic
writing remain their separately ordered tasks. The default template will be
original package-owned content under `packages/docx`; this reader needs no
creation asset and imports none of the test templates as a product default.

## Failing-test-first evidence

1. `npm test --workspace=docx`: original 46 tests passed; new reader suite failed
   importing missing `./index.js`. Implemented the boundary only after this red.
2. First reader implementation: all 59 tests passed.
3. ZIP64 public-reader and zero-metadata cases added: 60 passed, one failed
   because zero extra/comment ceilings were incorrectly treated as positive-only.
   Fixed that admitted-value distinction; all 61 then passed.
4. Inspected fixed raw decoder workspace allocations and added a small original
   regression for retained decoder capacity. The bound tests reproduced two
   failures (60 passed): insufficient retained ceilings incorrectly resolved.
   Reserved decoder workspace and two live output chunks before decoding.
5. New strict test type check failed on original tuple/index annotations. Added
   type-only annotations without relaxing compiler options or original assertions.

Independent review corrected a cancellation test title: its immediate abort
proves cancellation at the parser's first suspension, not a specifically measured
inflation checkpoint. Shared codec tests separately preserve cooperative behavior.
No reader test is claimed as a writer ownership or full document conformance pass.

## Final verification

- `npm test --workspace=docx`: 62 tests, including all 46 original tests.
- `npm test --workspace=@poe-code/office-package`: 32 existing tests passed.
- `npm run lint --workspace=docx`: ESLint, strict source and test type checks.
- `npm run build:workspaces -- --workspace=docx`: uncached maintained declaration-
  derived build closure, shared codec then DOCX; no root-only substitute.
- Leaf existing archive behavior: 194 passing tests covering zip-format,
  zip-codec, zip-review, zip-atomic-ownership, zip-standard-flags, zip and unzip.
  Maintained runner uses `test-reporting.mjs --import tsx --test-concurrency=1`.
- Leaf guarded input review: seven focused shared/ZIP/archive inventory checks
  passed. An initial runner invocation omitted the TS loader and failed before
  test execution; corrected invocation passed and no product workaround was made.
- Built workspace ESM import `from "docx"`: empty archive, typed input failure,
  typed byte-budget failure verified without a source alias.
- `npm pack --workspace=docx --dry-run --ignore-scripts --json`: exactly seven
  entries (four built JS/declaration files, manifest, license, preserved notice).
  This is a pack inventory check, not an isolated installed-tarball runtime claim.

No visual CLI behavior changed, so no screenshots apply. No native/reference
build, external corpus, renderer, browser/worker or release verification is claimed.
The maintained package checks are scoped to the added consumer; shared codec and
shell source are unchanged. README remains only a draft under `docs/docx` pending
explicit permission. No push or release is authorized for this task.
