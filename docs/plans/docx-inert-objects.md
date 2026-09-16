# Bounded inert object inventory and extraction

Scope: F40 only. Later tasks remain pending. Preserve historical inventories and unrelated work.

- [x] Establish failing original in-memory regressions before product edits.
- [x] Inventory OLE/package relationships, object carriers and preview ownership, including shared resources and chart workbook packages.
- [x] Preserve binary/preview bytes on unrelated edits; never decode, activate, fetch or execute embedded content.
- [x] Extract exact bytes through explicit bounded VFS authority, safe generated names, deterministic manifests and truthful publication receipts.
- [x] Verify missing targets, unsafe destinations, exact limits, CLI/SDK schemas and security metadata.
- [x] Run maintained scope checks and commit only owned files on main; no push/release.

JS/security mapping: async Uint8Array input and explicit capability filesystem replace host paths and application activation. Inventory returns readonly snapshots with revision-bound Location tokens, zero-based JS arrays and stored byte sizes/SHA-256. CLI selectors remain one-based. Embedded binaries remain opaque; macro/protection state is unknown unless declared by admitted outer package metadata. No password/hash/key values or credential-bearing external targets are emitted. Missing internal targets retain existing invalid-package admission; unresolved carrier IDs are reported. Protected outer documents remain readable and extraction is not a protection bypass/editor.

Public API audit: F40 is an additive utility family, not a new live owner or whole-model implementation. Existing inherited package members, enums, collections, helpers and documented public underscore-prefixed members retain their explicit inventory obligations. The pinned inventory is historical evidence; no naming-based exclusions or wholesale promotion. Resolve only bounded embedding documentation drift with verified evidence here.

## Executed bounded evidence

Before implementation, the original `objects list` command regression failed with
`unsupported-profile`. Before their corrections, independent regressions also
failed for unknown carriers, missing shape IDs matching by absence, unescaped
human MIME metadata, inventory-versus-receipt output admission and loose location
schema fields. All inputs are originally authored ZIP/XML/byte arrays and memfs
mutations; a complete original workbook ZIP also verifies exact extraction bytes.
No downloads, native reference build, host application, object activation or
product networking was used.

`inspectDocumentObjects(input, options, context)` is always async and returns
readonly metadata snapshots. `extractDocumentObjects(input, options, context)` is
always async and requires canonical absolute VFS outputDir and an explicit
filesystem. The CLI resolves caller-relative directories through its supplied cwd;
SDK directory paths are already canonical. It uses the same domain functions.
Unknown API options/accessors reject, ordinals are one-based CLI selections,
arrays are zero-based JS snapshots, source SHA-256/generation guards reject stale
tokens, and text-range tokens are inapplicable. Generic planned selectors without
bounded ownership semantics remain unsupported; this milestone does not expand
live owners, model batches or the full public API.

Inventory without selectors is package-global: OLE carriers in stored XML,
OLE/package edges including chart workbook bindings, and detached declared OLE or
embedding-folder payloads. Story/paragraph/run/table/cell/section/note/comment
selectors narrow physical owner descendants. Preview resources are associated
only through one explicitly identified matching VML shape; missing/duplicate
shape IDs remain ambiguous. Shared resources retain separate physical occurrences
and owner groups; closure traversal handles shared/cyclic edges without activation.
External targets are redacted, including credentials, queries and fragments.
Unknown carriers never dump XML, contained text or binary payloads. Outer macros
retain admission rejection. Outer protection is reported as a boolean with no
password/hash/salt values; embedded protection is unknown and macro presence is
reported only when declared by the embedded resource MIME.

Extraction emits exact payloads as `object-N.bin`, separate entries for shared
occurrences, source hashes and owner tokens, and deterministic `manifest.json`.
Previews are inventoried/preserved and are not separately extracted by objects.
Missing carrier IDs/linked resources skip with complete false. Missing internal
part targets retain invalid-package admission, not fabricated placeholder bytes.
The manifest counts toward file/byte limits and multi-output consent. Canonical
path checks, per-destination VFS capabilities/identity, collision/symlink refusal
and all output-size admissions precede staging. Publication/cancellation errors
carry actual receipts; completed files are never claimed rolled back.

Visual QA procedure executed: invoke the injected command engine with an original
in-memory package/workbook binding and memfs publication capabilities, capture
human `objects list` and `objects extract` output with the repository screenshot
route, then inspect the resulting PNG. Both exit 0 with readable inventory and
truthful completion text. The opt-in utility is not a root poe-code subcommand,
so `npm run screenshot -- --output /tmp/docx-inert-objects.png --no-header node …`
was used rather than routing it through the unrelated root CLI. Screenshot and
logs remain disposable QA artifacts outside commits.

The API inventory was parsed in full (920 research entries). There is no dedicated
live OLE owner in that pin. `Package`/`OpcPackage` relationships, inherited `Part`
and `XmlPart` byte/resource APIs remain security-mapped obligations; inline-shape
enums and collections retain their planned/language-mapped dispositions. Utility
snapshots neither implement nor conceal those members. Historical source/test
and documentation-error dispositions remain unchanged.

## Final verification

- `npm run test --workspace=docx`: 139 files, 2,900 tests passed.
- `npm run lint --workspace=docx`: passed ESLint and source/test TypeScript checks; the existing type-only-unused-variable warning remains unchanged.
- `npm run build:workspaces -- --workspace=docx`: maintained selected workspace closure passed (five build stages including required dependencies).
- Safe-bash focused serial Node test route: four object shell tests passed. Exact normal-runner membership regression: one test passed. The package npm runner accepts all discovered files even with a file operand; the accidentally broad invocation was interrupted and is not claimed as a pass. Its current implementation does not support SAFE_BASH_TEST_RG. No runner policy was altered.
- Original failing-before-fix cases and screenshot inspected as recorded above; `git diff --check` passed.

Delivery: one owned atomic feature commit on main, no push or release. Later tasks remain pending.
