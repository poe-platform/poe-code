# Bounded package tools research receipt

This receipt accounts for package byte behavior and explicit package-tool boundaries. It does not establish complete F60 or whole-public-API conformance. The [case ledger](package-tools-case-map.json) retains all 157 OPC unit variants, including all 29 serialized-package cases, and seven relevant expanded BDD scenarios. Each row names existing original TypeScript assertions or an explicit gap/security/architecture disposition. Source identities occur only in research records.

The [test audit](upstream-test-audit.md) and [API audit](upstream-api-audit.md) remain the pinned research authorities. Their historical implementation status is not a current implementation receipt. The old central case ledger still lists writer cases as awaiting semantic review although independently asserted writer tests now exist; this bounded ledger records that drift without rewriting unrelated accounting.

The original byte-reader tests use authored archives and explicit memfs capabilities. The writer tests inspect ZIP records using the separate test reader, comparing exact payloads and container fields rather than using production reader/writer round trips as the sole oracle. Existing content-type tests retain every selected override/default category, case variation and typed missing/invalid lookup. These tests were inspected for this receipt; inspection alone is not a fresh passing-test claim.

Exact language and security mappings:

| Source behavior | Bounded JavaScript behavior |
| --- | --- |
| File/path or file-like admission | Async `readPackage(input, context)` admits owned `Uint8Array`, explicit pull sources, or `{path, capability}`. Bare host path strings fail. Admission finishes before a reader becomes visible. |
| Lazy ZIP member reader | Eager bounded validation; corruption in a later member prevents returning any reader. `get` returns owned bytes; `has` reports membership; `relsXmlFor` returns bytes or `null` without creating parts. |
| Python ZIP writer factory/context manager | Async complete-byte serialization with explicit store/auto compression policy. Native ZIP objects and file handles are not exposed; independently inspected archive bytes replace private mock-call topology. |
| Part-name value subclass | Validated package-URI metadata and relative-reference helpers. ASCII identity matching does not fold Unicode; unsafe percent encodings, traversal and part-prefix collisions fail. |
| Content-type dictionary | Explicit validated override/default lookup. Missing bindings produce `missing-binding`, invalid key types `invalid-type`; the low-level writer preserves supplied type XML rather than synthesizing a live part model. |
| Implicit directory loading | Explicit manifest reconstruction through caller-supplied VFS authority. No scanning or implicit native filesystem interpretation. This is a security mapping, not a promise of a live directory-backed package reader. |
| Package resource preservation | Opaque member payloads remain bytes. External relationships are metadata and are never fetched. SHA-256 is integrity metadata, independent of documented image SHA-1 compatibility metadata. |

The shared SDK contract continues to require neutral model spellings such as `Presentation` and `save`, direct properties, inherited members, collections, enums, helpers and bounded `part`/`element` views. Operation functions do not replace these obligations. Underscore-prefixed public types remain in [the complete inventory](upstream-api-inventory.json); none are excluded here because of their names. The `Presentation(input?: BinaryInput | null, context?: OfficeContext): Promise<Presentation>` and `save(file: BinaryOutput): Promise<void>` research mappings are distinct from lower-level archive helpers. Whole-public-API coverage remains incomplete.

The F60 text references `PackManifest` without defining its fields in the original specification checkpoint. A concrete closed shape and reconstruction semantics are required; an extraction manifest cannot be assumed to be a complete repack manifest, especially after selected extraction or partial remote publication. The bounded implementation must disclose its schema explicitly. A valid ZIP alone is insufficient: repack admission must validate content types, canonical unique names, matching resource hashes and the complete graph before returning publishable bytes.

No corpus files were downloaded, modified, committed or made test dependencies by this documentation work. The [corpus manifest](corpus-manifest.json) remains the disposable QA authority. The root agent executed one in-memory SDK corpus round trip: the manifest-listed template with source SHA-256 `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c` retained all 38 sorted member names and every member hash after extraction and repack. Output was 1,270,189 bytes, SHA-256 `05846fc8c20f228ed2301f27a509736dae919e92d3c7ccab75acebe424333c51`; the disk source hash stayed unchanged and no output artifact was written. The supplied profile was 16 MiB byte/archive/total limits, 8 MiB entry/XML limits, 1,000 members, 100,000 XML nodes, depth 256 and 10,000 relationships. This establishes one bounded SDK preservation result, not corpus-wide or visual fidelity. Planning and QA procedures belong in `docs/plans`; this file records evidence only. Required standalone [upstream notice](upstream-license-notice.txt) and [case-map notice](test-case-map-notice.txt) remain in place.

The root agent also ran the maintained complete package unit route and reported 4,432 passes with three failures in existing unowned sanitization work (two command cases and one shared-notes case). This is a package-wide failing result, distinct from any focused package-tools checks. No unowned sanitization files were edited for this receipt.

The package command agent reports all six original command-package-tool tests passing. Their source assertions cover complete SDK-backed extraction/repack, closed discovery schemas, successful result-schema validation, invalid flags before reads, directory collisions before writes, preservation of unrelated files, exact completed-output manifests after simulated remote failure, and manifest-relative sources with dry-run publication suppression. The partial failure result is checked against the advertised extraction schema. This is a focused execution report, not a passing full-package result.

The final bounded manifest shape is documented in [draft usage](package-tools-usage.md): `{parts:[{part,sha256,file:{vfsPath}}]}`. Extraction returns output metadata separately, requiring explicit conversion. Metadata-authoring options fail as unsupported before admission; repack preserves existing metadata. The SDK snapshot regressions additionally cover accessor rejection and owning later byte members before an earlier asynchronous source resolves. Final maintained-check commands and commit identity belong in the root delivery receipt.

Final focused verification passed 13 SDK package-tool cases, eight command cases
and four actual Shell cases using public `pptx` imports. The Shell success case
compares every member byte through an independent ZIP inspector. Package lint
(source and test types included) and the selected workspace build closure passed.
The working-tree runner passed 498/499 tests: its sole failure is an unrelated
assertion for an absent sanitization test. The exact registry candidate selected
for commit passed the affected discovery test separately. No global passing-gate
claim is made. Actual Shell help/error screenshots were visually inspected;
this is terminal QA, not slide-rendering evidence.
