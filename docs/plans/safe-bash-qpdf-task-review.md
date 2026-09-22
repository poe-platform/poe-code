# behavior-qpdf task review

Reviewed the current working tree on 2026-09-21 at HEAD `ab1fa8d34101e1e7f61272973f3bc28a842043d8`. Completion is blocked. This review does not change other contributors' implementation statuses or files.

## Unresolved findings

| Finding | Validated evidence | Required resolution |
| --- | --- | --- |
| Behavior completion is unsupported | The diff in `safe-bash-qpdf.md` changes `behavior-qpdf` implementation from open to done, and engine implementation/refactor/test to done. Package source searches find no qpdf implementation. | Keep behavior acceptance open until real implementation, failing edge-case tests and independently verified passing results exist. The existing status edits are preserved. |
| Required shared parser is absent | No `parsePdf`, `parsePDF`, `PdfParser`, `PDFParser` or `rawObjects` implementation was found in package TypeScript source. `packages/pdf/src/index.ts` supplies layout rendering; the shared parser plan still leaves its byte/object/revision API tasks open. | Implement and qualify the shared parser contract before dependent page imports, revision handling, inspection and transformations. Do not substitute an invented command-local parser interface. |
| Existing writer cannot satisfy the contract | `packages/pdf/src/serialization.ts` rejects sparse identities, nonzero generations, Encrypt and ID, and emits only Root/Info trailer entries. It imports pdf-lib; the renderer manifest also depends on fontkit and pako. | Qualify a distinct first-party graph writer, including unknown reachable objects/trailer keys, raw streams, aliasing, offsets, remapping and explicit retained-byte/work accounting. Preserve the renderer's existing scope. |
| Package and installed API are absent | Direct existence check: `packages/safe-bash-command-qpdf` does not exist. Parsed safe-bash manifest: `./commands/qpdf` export and command dependency are absent. | Integrate a real private ESM implementation, then independently verify runtime/declaration bundling and CLI/SDK equivalence in isolated installed consumers. |

The requested package-pattern file is deleted in existing edits; its available archived counterpart, `archive/safe-bash-command-package-pattern.md`, prohibits empty command scaffolds and assigns shared parsing to a private engine. No scaffold, external-runtime adapter or unsupported-only command was added.

## Review boundaries and next increments

There is no qpdf runtime diff to review for unnecessary abstractions, proxy functions, duplication or compatibility regressions. Failure paths, cancellation, cleanup, ownership, input/decoded/retained/output accounting, algorithm work, recursion and snapshot/version compatibility are **unverified**, not passes. All G01–G60 and O001–O140 cells in `safe-bash-qpdf-acceptance.md` remain open; the supplied pinned-source/native controls do not qualify an absent implementation.

After the shared parser contract exists, start with failing memory fixtures for sparse/nonzero-generation references, newest-revision replacement/free entries, shared resources and unknown reachable binary streams/trailer references. Qualify writer offsets and lengths independently before page transformations. Review each later cell separately, including metadata semantics, permissions, signature invalidation, explicit bounded repair and true linearization hint/range-reader checks. Preserve documented safe publication and strict-selector deviations from native behavior.

Verification here was read-only diff/source inspection and parsed manifest/existence checks. Only this review document was added. No code changed, so no TDD cycle, unit/build execution or screenshot validation is claimed. No native controls were rerun, package published, commit created, push completed or release verified.
