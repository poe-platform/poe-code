# Bounded ordered DOCX utility operations

Status: Implemented utility executor; source-ownership regression verified on
2026-09-21. Later tasks remain pending.

## Scope and contract

The original TypeScript utility accepts `{ version: 1, operations: [...] }`
through `executeDocumentBatch` and CLI `batch --ops-json` / `--ops-file`.
The shared Office CLI and SDK contracts govern closed argument schemas,
plural resources, selection, publication flags, result envelopes and exit codes.
Explicit IDs are unique ASCII identifiers of at most 64 characters; omitted IDs
resolve to `step1`, `step2`, etc., including collision detection. The default
operation ceiling is 1,000; caller limits can only lower host ceilings.

The bounded registry covers fields.add/set, toc.add/set, captions.add/set,
paragraphs.add/set, runs.add/set, tables.add/set/get/list, tables.rows.add/remove,
tables.columns.add/remove, tables.merge/split, text.replace/get, lorem.set,
images.add/replace/set/list/get, properties.set/remove/list/get and fields.list.
Availability remains subject to each operation's declared supported subset.
Mixed utility/model arrays and unrelated model operations reject unpublished.

Whole-array syntax admission rejects unknown keys, malformed arguments, duplicate
IDs, evaluation, callbacks and explicit dual stdin consumers before edits.
The executor decompresses the source once, caches unchanged admitted XML,
resolves later selections against staged state, shares budgets across operations,
validates the final package and publishes once. A later failure discards staged
changes and reports the failing zero-based index and resolved ID.

## Exact JavaScript and security mappings

| Concern | Mapping |
| --- | --- |
| Ordered operations | Typed version-1 records; no callback or dynamic member invocation |
| IDs | Optional owned strings; deterministic generated IDs; uniqueness includes generated IDs |
| Source | Owned Uint8Array snapshot before asynchronous acquisition; retained-byte reservation before copying |
| Resource I/O | Always async; owned base64 bytes or explicitly capability-scoped VFS descriptors |
| Selection | One-based utility ordinals; fingerprinted tokens with staged generations; model indexing stays zero-based |
| Stdin | Explicit command sources reserve stdin; JSON VFS `-` is a literal path; binary stdin descriptors reject |
| Budgets | Shared invocation ledger; counts, work, retention, matches and expansion do not reset per operation |
| Publication | One outer validated publication; no host filesystem, native process or product network fallback |
| Failures | Prepublication data remains null; prior input and forced destination bytes remain intact |

The pinned `docs/docx/upstream-api-inventory.json` and documentation audit were
reviewed. This utility milestone does not promote any live-model inventory row.
Neutral method/property spellings, inherited members, enums, collections,
helpers, prose-only APIs and public underscore-prefixed types retain their
existing obligations. Whole-public-API coverage remains incomplete.

## Regression and documentation reconciliation

Existing original tests cover field-result to placeholder replacement to table
construction/update, exact image retention, metadata, invalid final syntax and
semantic selection, CLI/SDK parity, one acquisition/publication and cumulative
budgets. They use original in-memory data and memfs for mutations.

A new regression overwrites the caller's source buffer during explicit image
acquisition. Before the fix, later locations fingerprinted the overwritten buffer
despite successful staged edits. After a budgeted source snapshot, later locations
retain the admitted source fingerprint and the final image/text package publishes
once. The regression failed before production code changed and passed afterward.

This document restores the missing milestone target already linked by the format
spec and documentation audit. Historical evidence and the pinned inventory remain
unchanged. No downloaded fixtures, derived material or native reference build were
used. General model batches, template utility batches and later tasks remain pending.

## Maintained verification

- `npm run test --workspace=docx`: 247 files and 5,162 tests passed.
- `npm run lint --workspace=docx`: passed, including both TypeScript checks;
  one warning in unchanged operation-types.test.ts.
- `npm run build:workspaces -- --workspace=docx`: selected declaration-derived
  build closure passed with the shared cache enabled.
- Batch help rendered with the maintained screenshot command and inspected;
  disposable evidence removed from the workspace's ignored out directory.

Only this bounded task is delivered locally. No push or release is authorized.
