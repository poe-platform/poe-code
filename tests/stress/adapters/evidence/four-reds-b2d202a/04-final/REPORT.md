# Four old adapter-stress assertions: bounded implementation checkpoint

## Scope and outcome

Frozen input b2d202a7a2c8831df9c2d143bc43c74d1a099b14 plus only the owned S3/WebDAV and adapter-stress changes listed in provenance.json. Node v22.22.2; tsx4.23.12; TypeScript5.9.3. Each phase used a fresh archive and outside-repository outputs. Other authors' live identity/command changes were deliberately excluded. This is not a full-repository or alias-closure result.

| Original row (3731587 line) | Classification and exact correction | Final disposition |
| --- | --- | --- |
| S3 mode, core36; masked X_OK37 | Shared-contract/security ambiguity. Local S3 README describes advisory creation metadata, but shared contract still does not authorize replacing a protection requirement with metadata. No assertion/source change for this row. | Still required red. chmod ENOTSUP and the original X_OK ENOTSUP expectation remain. |
| S3 truncate, core64 | Obsolete name-based unsupported expectation. Existing source has conditional bounded truncate; exercise exact shrink/zero-padding/invalid-length preservation. Add missing-conditional-PUT, racing-writer, bounded-growth and no-download zero-truncate controls. | Fixed, no new backend feature. |
| WebDAV timestamps, core43 | Original MockDav lacks PROPPATCH. Positive row now uses existing PropertyDav over real loopback fetch; its fixture decodes Uint8Array XML correctly. Original501 provider remains an explicit typed ENOTSUP/no-effects control, not a skipped case. | Fixed capable profile; unsupported-provider limits retained. |
| S3 default rename, s3test106 | Obsolete always-reject default. Preserve original zero-host-effects negative with explicit allowNonAtomicRename:false; separately require guarded default success for copy/buffered-PUT/streamed-PUT, creation/replacement, exact namespace/bytes and atomicRename:false. | Fixed; guard downgrades, races and partial effects stay explicit. |

No unconditional own-product source defect was established. All seven S3/WebDAV product .ts files remain byte-identical to the frozen base. Existing d52634b,9e90573,3731587 behavior was tested, not reimplemented. Source references: src/fs/s3/filesystem.ts:119,389,424,593,707,717,758; src/fs/webdav/webdav.ts:829; tests/fs/webdav/mock.ts:147; tests/fs/webdav/property-fixture.ts:10. Shared types declare optional numeric modes and capability booleans but do not resolve the disputed security/negotiation meaning.

## Exact validation, not summed denominators

| Gate | Pass/total | Fail | Exit |
| --- | --- | --- | --- |
| Fresh unchanged four original rows | 0/4 | 4 | 1 |
| Fresh unchanged original stress cohort | 66/70 | 4 | 1 |
| Corrected same 70-row cohort | 69/70 | 1 | 1 |
| Candidate stress including 29 added controls | 98/99 | 1 | 1 |
| Safe workflow controls (subset of99) | 6/6 | 0 | 0 |
| Existing S3/WebDAV backend suites | 503/503 | 0 | 0 |
| Shared S3/WebDAV conformance | 100/100 +2 provenance checks | 0 | 0 |
| Strict scoped TypeScript entrypoints | completed | 0 diagnostics | 0 |

Every test gate has zero skipped, cancelled and TODO cases. The sole candidate red remains the original S3 metadata row, failing at explicit mode creation before its X_OK assertion. New control totals: truncate3, rename12, timestamps8, safe workflows6. Scoped types include owned source/test roots, resolve transitive imports against the frozen archive, and do not claim whole-repo typechecking. The unchanged aggregate adapter-tools matrix was NOT rerun or edited: 421ce3f retains 77/79 and required S3/WebDAV `/work/scratch/nested` empty-directory failures. The original6a259ff 71/79 cohort stays separately diagnostic.

**Erratum to sibling03-webdav-corrected/REPORT.md:** its prose says existing timestamp backend7/7; the immutable raw TAP correctly records **6/6**. Raw output is authoritative; no seventh case exists. Selected earlier gates overlap final suites: truncate4/4+3/3+14/14, rename16/16+34/34, timestamps1/1+8/8+6/6. Do not add them as unique acceptance cases.

Commits before this final documentation/evidence commit:435476d (truncate), d29754d (rename),6fd16dd (WebDAV fixture/profile). A concurrent narrow correction55e4102 supplies a typed getObjectStream spy in the new truncate control; it is included in final source hashes and the successful scoped typecheck, not attributed to this leaf. It preserves and strengthens the zero-download check.

## Precise root → Curie questions (not waived)

1. For permissions:false, must explicit mode on writeFile/writeStream/mkdir be rejected unless actual protection is enforced, or may a backend explicitly advertise persistent advisory metadata without enforcement? The original stress expects rejection; S3 currently resolves mode0600 creation and exposes0600 in a fresh instance. Does the shared contract authorize that profile, or is this an S3 source defect? Do not interpret private staging modes as IAM/ACL isolation.
2. Under permissions:false, must X_OK be ENOTSUP, or are synthetic regular-file EACCES and successful directory traversal permitted? The masked independent observation records actual EACCES for the file and success for the directory. chmod is typed ENOTSUP before any request. These observations are not acceptance assertions or an agreed ruling.
3. Does timestamps:true mean implemented functionality subject to documented provider prerequisites, or successfully negotiated support for this configured provider? Current WebDAV README explicitly says the former, shared types/Markdown are silent. The capable positive and original501 negative are both preserved; if negotiated support is required, central API/profile design and a separate source correction are needed. No new field/negotiation protocol was invented.

The listed Curie agent ID was unavailable in this leaf session (agent-not-found). Root must route these questions; no reply or approval is assumed. Do not wait indefinitely or label the first row obsolete. The live shared contract was read again after the identity-contract addition; it still does not adjudicate these questions.

## Safe cleanup alternatives are different workflows

Both owned READMEs document and remote-safe-workflows.test.ts verifies: named-file cleanup retaining remote parents; bounded VFS-only MemoryFileSystem staging with explicit exclusive named-result publication and local safe rmdir; and separately caller-requested destructive recursive deletion preserving an outside sibling. The failing remote empty-only operation still reports typed ENOTSUP/path with exact backing state and no mutation requests. No list-empty/recursive fallback exists in these alternatives. This is mock/loopback evidence, not deployment certification or transparent cross-adapter command support.

Native empty-only removal is still unavailable remotely. Standard WebDAV collection DELETE is recursive (RFC4918§9.6.1); S3 DeleteObject If-Match concerns one object's ETag, not prefix membership. A future reviewed integration would need authoritative emptiness/removal or exclusion of all relevant writers; existing APIs provide no such injectable safe-rmdir guarantee. No protocol/lifecycle/lock breadth was added. Named-file deletion/explicit recursive operations retain their ordinary race/partial-effect limits. S3 rename remains non-atomic, ETag ABA is not incarnation identity, and directory listings are not snapshots.

Primary protocol references inspected August26,2026 only: https://www.rfc-editor.org/rfc/rfc4918.html#section-9.2 ; https://www.rfc-editor.org/rfc/rfc4918.html#section-9.6.1 ; https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html . RFC4918 PROPPATCH instructions/property statuses support the fixture distinction; HTTP207 is not sufficient success and no protected native timestamp was modified.

## Evidence integrity and replay

Old ebe36d2 evidence is unchanged: Git subtree0140237e38a79a53090485a2925b8dbba486ee46. Original report SHA256f5e510b0eb02af8f85255220d3730a8ec5f21a3796c65870bde395d1c2bd5dce and raw stress SHA25656fcd57a03e6727b56c937528abb7d70eeca1f2e0077b087a681643b468d0700 remain in that original evidence. No old audit report/output was overwritten.

Each phase stores exact argv/exit/raw output and before/after source manifests. SHA256SUMS covers the sealed new artifacts. replay-<phase>.patch supplements the historical phases with their exact owned-source deltas captured from their still-isolated archives, including unsuccessful test-author iterations. Apply the selected patch using apply_patch in a fresh git archive of the frozen input; verify its manifest-before.json; run the recorded argv with the recorded dev-tool versions and outputs in a fresh /tmp directory. Permission observations use the supplied permission-profile-probe.mjs with cwd at that archive (adjust the script path only). The patches do not depend on later live file contents. Initial00-original/01-truncate logs are loader-setup failures, not test acceptance; the supplied runner records the corrected node_modules setup. They are not mislabeled product failures.

live-owned-checkpoint.json records the read-only concurrent global status and confirms all owned committed non-evidence files match the tested final archive. Its seven-product-source manifest SHA256 is cebafeb58476476fb48dedb66ae6e9d792223fff89c6b55987b05da636c820e7. Other five FS source edits are author-owned, were not staged, and were not included in this frozen validation. No contracts, commands, matrix, remote-cancellation or S3-policy files changed in this leaf. No own runner/server remains active at completion; no delegation, fullrepo/all-FS suite, or unrelated shell/curl run occurred.
