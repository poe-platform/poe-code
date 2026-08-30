# Historical reachable consumer census and SOURCEONLY gaps

Frozen before reading concurrent path-transport-v2 source. References below are
relative to `tests/commands/apply-patch-independent-20260828/`. Exact byte hashes
for all twelve historical source files are in `SOURCE-INVENTORY.json`.
This is a source census, not a test result or permission to edit old files.

## Actual-v1 preparation/controller chain: 14 sites

| ID | Historical source site | Input, next consumer and frozen obligation |
| --- | --- | --- |
| G01 | actual-v1/capture-metadata.mjs:48 | cat-file type and rev-parse scalar commit identities. These are not pathname records; validate exact scalar grammar separately. |
| G02 | actual-v1/capture-metadata.mjs:52 | git show evidence:author-manifest and evidence:base-manifest. Fixed paths today; later variable path consumers must bind raw paths or use authenticated OIDs, not display spelling/pathspec interpretation. |
| G03 | actual-v1/capture-metadata.mjs:54 | selected apply-patch source ls-tree lacks -z; trim/newline/whitespace split at line 58 destroys names before sourceEntries binding. Primary root repair alone misses this route. |
| G04 | actual-v1/capture-metadata.mjs:55 | complete candidate ls-tree lacks -z; toString persisted as candidateTrackedInventory at line 73. Its digest authenticates display bytes, not raw paths. |
| G05 | actual-v1/controller.mjs:112; actual-v1/supervisor.mjs:40 | child output collection copies stdout bytes and exposes stdoutBase64; controller line 128 reconstructs raw stdout before fragmenting. Preserve actual bytes through this boundary. |
| G06 | actual-v1/controller.mjs:129 | 65536-byte fragments carry channel/offset/totalBytes/base64/SHA256; receipt carries fragment name/bytes/SHA256 and aggregate channel digests. Hashing receipt JSON alone does not verify stored fragment bodies. |
| G07 | actual-v1/controller.mjs:257 | base ls-tree already uses -rz; parseTree at line 148 decodes whole input as UTF-8, splits NUL and filters empties without checking final terminator/header domain. Raw command flags alone are insufficient. |
| G08 | actual-v1/controller.mjs:261 | candidate inventory trimEnd/newline parser treats C quoting as bytes. Main historical blocker, but only one of these sites. |
| G09 | actual-v1/controller.mjs:263 | base/candidate and selected revision:path requests joined with LF for cat-file --batch. Newline names cannot be transported safely this way. Resolve raw paths against authenticated trees and request OIDs; do not escape/normalize filenames into invented requests. |
| G10 | actual-v1/controller.mjs:172 | batchObjects parses header/body sizes, hashes payload and maps request to returned object. Require strict framing/kinds/sizes, exact request identity, no extra/truncated bodies and no duplicate path loss. |
| G11 | actual-v1/controller.mjs:267 | commit body first-line tree assertions bind tree values but do not explicitly compare returned commit objectId to requested commit identity. A correctly hashed different commit with same tree is not the requested commit. |
| G12 | actual-v1/controller.mjs:270 | overrides Map, composed entries and treeHash at line 154; authenticate every override path/mode/OID and duplicate/conflict behavior. Derived 8437 tree is not automatically a stored object. Preserve directory-byte ordering and all leaves. |
| G13 | actual-v1/controller.mjs:278 | selected input objectId/SHA256/bytes checked and matched to parent by path; mode is globally asserted 100644, parent binding checks blob only. Narrow materialization may refuse other modes, but whole Git inventories must retain valid modes and selected binding must not silently mismatch them. No materialization is authorized now. |
| G14 | actual-v1/controller.mjs:340 | git show exact start.commit:fixed RUNTIME-SEAL path, followed by body comparison. Fixed-path metadata retrieval is a reachable Git consumer even after initial admission; preserve authenticated bytes/commit binding. No actual runtime seal route may run in this phase. |

## Preserved DATA forensic chain: two sites

| ID | Historical source site | Input, next consumer and frozen obligation |
| --- | --- | --- |
| F01 | actual-v1/forensic-data.mjs:19 | receipt.fragments filtered by filename, decoded, sorted by offset, hash/length checked and concatenated. It does not validate every record channel/total or original sequence order. New DATA qualification must bind actual body, not reuse a permissive receipt-only assertion. |
| F02 | actual-v1/forensic-data.mjs:72 | batch body decoding, candidate commit OID assertion, historical display unquoting and canonical tree reconstruction. This diagnosis is historical DATA only, not a repaired runtime consumer; preserve it rather than replacing it. |

## Adjacent frozen preparation gates: five sites

| ID | Historical source site | Input, next consumer and frozen obligation |
| --- | --- | --- |
| A01 | admission-plan/capture-inputs.mjs:43 | git show blob bytes and ls-tree display string per preparation path; persisted gitTreeRecord is trimmed. Read-only predecessor input, not a raw-path-qualified reusable source. |
| A02 | admission-plan/capture-inputs.mjs:49 | pinned author case/manifests use the same show + ls-tree display pairing. Fixed names do not prove general path correctness. |
| A03 | admission-plan/check-data.mjs:53 | regex over gitTreeRecord only accepts regular/executable blob lines and compares display path to entry.path. Keep separate from general raw Git inventory parsing. |
| A04 | admission-plan/check-data.mjs:69 | commit type checks, ls-tree name-only and full records split by newline, sorted for comparisons; git show each listed path. Any new reuse reintroduces the transport concern unless isolated/replaced in owned v2 code. |
| A05 | matrix/check-data-v1.mjs:233 | two-leaf canonical DATA tree and unsupported stored-claim refusal. No Git spawn here; authenticates derived bytes without requiring object storage. Existing T21/T22 are unchanged, not a broad tree reference. |

Total: **21 enumerated sites** across the historical Git preparation, capture,
parser, composition, forensic and adjacent gate routes. The twelve source-file
closure additionally includes actual-v1 deadline, bootstrap, loader, guard-control
and worker: these have no additional direct Git invocation. Controller imports
supervisor/deadline; guard/bootstrap import loader; bootstrap imports worker;
worker imports product JS only in an unauthorized later phase. Those files were
read as source DATA, never imported. This census does not claim the unread
author's new closure has the same sites or file count.

## Early genuine gaps, all SOURCEONLY

1. **A candidate-only -z repair is incomplete.** G03's selected-source whitespace
   parser, G07's lossy/permissive base parser and G09's LF revision:path requests
   are independently reachable path consumers. H/P/R/B/M controls cover them.
2. **Capture acceptance must examine body bytes and framing.** F01 can reorder
   fragments and does not bind channel/total metadata. The controller's receipt
   write assertion G06 is not reassembly authentication. C01–C21 freeze concrete
   bodies and mutations, including split UTF-8 and split NUL boundaries.
3. **Requested commit identity needs binding, not only its tree.** G10/G11 can
   hash a returned object correctly yet fail to explicitly match the requested
   commit OID. Later review must exercise correct-object/wrong-request responses;
   tree equality alone cannot authenticate the requested commit provenance.
4. **Directory and mode semantics extend beyond quoted strings.** Sorting must
   use Git's virtual slash rule; selected-source and composition binding must
   preserve mode as well as path/OID, reject duplicate overrides and both
   file/directory conflict orders. P24–P26, R and M freeze these obligations.

These findings concern old harness source and future review obligations. They
are not allegations about unread v2 source and not product findings. The old
supervisor also decodes stderr to UTF-8 before the controller re-encodes it;
this is a separate historical byte-capture limitation, not evidence that actual
Git stdout was corrupted. No broad stderr/product/supervisor repair is requested
or authorized here. Historical 25 DATA / 68 NOT_RUN remains unchanged.
