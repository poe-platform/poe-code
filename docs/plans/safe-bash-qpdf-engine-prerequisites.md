# qpdf engine prerequisite evidence

Inspection date: 2026-09-21. Task: `engine-qpdf`. Status: blocked by missing shared PDF parser APIs; implementation and acceptance remain open.

The task explicitly requires consuming mature parser raw-object/revision APIs and a distinct qualified lossless writer. Current source inspection does not establish either prerequisite. Creating a replacement parser inside the command, importing the layout renderer, or exposing a placeholder engine would not satisfy that contract.

## Current source evidence

| Requirement | Source inspected | Finding |
| --- | --- | --- |
| Shared raw-object and revision APIs | Package source file inventory; `docs/plans/safe-bash-pdf-parser.md` tasks `pdf-byte-syntax`, `pdf-revisions`, and `pdf-parser-api` | These tasks remain open. No first-party PDF raw-object/revision implementation was found in package sources. Searches for `parsePdf`, `parsePDF`, `PdfParser`, `PDFParser`, and `rawObjects` returned no matches in package TypeScript outside generated artifacts, dependencies, and comparison fixtures. |
| Existing PDF public API | `packages/pdf/src/index.ts:7`, `packages/pdf/src/model.ts:1` | Exposes layout models, capabilities, limits, errors, and `renderPdf`; does not expose existing-document parsing or revision resolution. |
| Lossless writer qualification | `packages/pdf/src/serialization.ts:11` | Existing serializer is explicitly classic-xref, contiguous-identity, generation-zero serialization. It rejects sparse identities, nonzero generations, and trailer encryption or IDs; it cannot qualify the requested rewrite contract. |
| Zero external runtime dependencies | `packages/pdf/package.json`, `packages/pdf/src/serialization.ts:1` | Existing renderer depends on `pdf-lib`, `@pdf-lib/fontkit`, and `pako`; its serializer directly imports `pdf-lib`. Private workspace bundling does not make these dependencies first-party. |
| Command ownership and export | Parsed `packages/safe-bash/package.json`; existence check for `packages/safe-bash-command-qpdf` | No qpdf workspace, `./commands/qpdf` export, or qpdf runtime dependency currently exists. |
| Package convention | `docs/plans/archive/safe-bash-command-package-pattern.md` | The requested original path is deleted in unrelated workspace edits; its archived counterpart was read without restoring or changing either path. It prohibits empty command scaffolds and places shared parsing in narrowly scoped private engine packages. |

These are source findings, not executed runtime failure tests. No upstream native controls were rerun. The pinned qpdf revision `54d6053af283bbeb8b325f4886c0f65cc51f2b80` and supplied native observations remain reference evidence, not first-party qualification.

## Acceptance required before dependent integration

1. Establish the shared parser's typed raw byte/object/revision API and pass its independent qualification. Retain lexical string bytes, names, unknown dictionary entries, raw stream bytes/filter descriptions, object/generation identity, free entries, revision provenance, and newest-revision resolution. Strict failures, recoverable syntax diagnostics, unsupported features, cancellation, and resource exhaustion must remain distinct.
2. Before writer implementation, write fast original failing tests using this API and memory VFS. Cover nonzero generations, sparse identity remapping, shared-resource aliasing, incremental replacement/free entries, unknown extension dictionaries and binary streams, unknown trailer/catalog references, and reachable graph traversal. Distinguish default trailer-reachable retention from explicit preserve-unreferenced behavior; do not promise obsolete revision or signature byte preservation.
3. Implement the distinct writer in `packages/safe-bash-command-qpdf`, consuming the shared engine rather than duplicating it. Independently check generated xref offsets, stream lengths, reference mappings, and structural validity. Reject unqualified encryption, object-stream/version interactions, QDF, and linearization explicitly; dictionary presence is not linearization qualification. Test document features separately from catalog-key presence and distinguish untouched rewrite from page-tree transformations.
4. Test explicit cancellation and bounded input, object, nesting, stream, traversal, allocation, work, and output accounting before allocation/materialization. Test invocation cleanup and exclusive staged VFS publication, including destination identity changes and backup collisions. Keep IDs, clock, and crypto capabilities explicit. Do not use host executables, network, ambient files, native/WASM fallbacks, or downloaded dependencies.
5. Keep all 140 supplied named options visible with support/rejection status and exact errors when command admission is implemented. Preserve scoped grammar and CLI/SDK parity; malformed JSON selectors must fail without whole-document disclosure. Keep native qualification cells open unless executed.
6. Add the private ESM workspace and safe-bash composition/export only when a real engine can be integrated. Bundle implementation and declarations through maintained publication routes; verify an isolated installed consumer with no private workspaces. Do not publish the command package.

Only this evidence document was added. No runtime code, tests, manifests, existing plans, or exports were changed. No builds, screenshots, commits, pushes, or releases were performed. TDD remains required when prerequisite APIs permit real engine tests; missing-module tests or fabricated parser interfaces would not qualify this engine.
