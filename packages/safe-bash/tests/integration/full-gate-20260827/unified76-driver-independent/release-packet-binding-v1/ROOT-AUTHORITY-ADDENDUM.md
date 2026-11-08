# Root authority addendum — static binding only

Status: **STATIC_BINDINGS_MATCH_RELEASE_HOLD**. This is not a release receipt, gate result or shared-driver acceptance.

## Current root authority

The routed root assignment accepts HTML74, DU75 and composed Expr76 as scoped prerequisites. Expr acceptance is recipe `a316d868fd6b330653f893276b8f5970dfe8800f`, evidence `dc5ca91d8405961784ca40a8b439aa8936ecbba3`, matrix `tests/integration/expr-public-independent-20260827/r21-composed-public-v1/MATRIX.json` (SHA256 `c4be9baa4b72bccd0311e70fbbcf74332dd4b7d3476f40b9eefaf3bce29ab595`).

Prior pending-expr wording in the main independent receipt is historical, not the current routed root decision. That receipt and all parent/history files remain unchanged. The matrix remaining-coordinator wording does not undo the subsequent routed acceptance. This addendum does not accept the shared driver: its review remains pending seal; no moving `shared-v6` results were read.

Expr composes 100 retained runtime groups plus four corrected R21 groups backed by 16 new boundary outcomes; types are 32 retained plus eight separate N04 outcomes. Package36/P01/R25/R26/accepted DU29 are bound, not rerun. Original 104/40 failures remain unrescored. Author archive metadata is not fresh independent full-archive proof.

## Independent static checks

`RECEIPT.json` records full IDs, exact paths/hashes and checked selectors. The pinned release packet is `39dd983bf60c6934d9d8721e39557eae487d88ef`, at `tests/integration/full-gate-20260827/unified76-driver/release-packet-v1/LAUNCH.md`. All 81 distinct checked commit/path hash bindings match. Five sealed packet files, driver manifests/30 files, ten support files, two author-evidence references, expr matrix/recipe metadata and bounded fixture/source hashes were checked without importing repository code. The seal itself has a separately recorded computed hash.

The expr candidate is **44f00bf84278e3361b52106478d59c707ab7b2bc**, not gate candidate **f5e9fc49b6abb38e180cc9de16c95fced102ff75**. Their src tree matches exactly (`5876c6bf4ad9bc07f22cc46f8dbee99461981862`); the Git delta is exactly the four declared fixture files, whose hashes/blobs match. The package identity **c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd** is cross-bound metadata, not a tarball rehash or fresh build. Driver source **e062bcc1c79bf626541cc13ce35bad89e28dfe0a** and author evidence **69a77055fb180f34d47c7e3e4306a666c0d96f68** are intentionally different roles. No checked hash mismatch was found.

Normalized driver SHA256 was recomputed independently. Encoded profile/external manifest bytes were hashed but not decoded/traversed; normalized profile SHA256 remains cross-bound to its pinned receipt. The 14 phase names/statuses match static policy literals. 76 defaults, 632 canonical paths, 192 classifications, 256 cleanup inputs and 49+2 native assets are declarations, not executed coverage. Bounds and nonzero-HOLD behavior are recorded policy, not fresh controls.

## Precise release blocker

Packet `executionAuthorized`, `rootReleaseAuthorized`, `independentDriverAccepted` and `fullGateExecuted` are false. Template action is `PENDING_ROOT_RELEASE_UNIFIED76`, independent acceptance is false, and authorization/evidence are empty. Its three public flags are true. Expr matrix prerequisite proofs are marked satisfied while release/fullGate remain false. Historical `CANDIDATE.json.release=HOLD_PUBLIC_AND_DRIVER_REVIEW` is preserved, not treated as a current rejection of root-accepted prerequisites.

Root must receive exact independent acceptance of e062/normalized driver `3d8d2a15214f12c07b64e3223f5e0088989845b8f60a74abb0a521dba32fa018`, candidate f5, normalized profile `8c9363ea17f6a319acc783b1e7ec2a4d4dc0a00529692b9f2331f60571ab149f` and c109; then root must issue a separate matching explicit release receipt. That release is **still absent**. A10 completion does not authorize execution. Fresh runtime/native/dependency/support/permission/loader/SafeJS guards remain required at any later authorized launch.

The template-refusal result belongs to ROOT/AUTHOR evidence; this leaf did not run `requireRelease`, admission, controls, tests, builds, native tools or full gate. No private/archive access or independent runtime execution occurred. Prior 21 PASS/1 A10 HOLD and six-refusal/complete-binding HOLD history is unchanged. No valid release receipt was created.
