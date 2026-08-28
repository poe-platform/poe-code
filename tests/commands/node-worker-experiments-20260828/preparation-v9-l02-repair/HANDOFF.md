# L02 source repair / DATA control preseal

Original evidence 345b9851f00e77ba520014b36567259440fd4ed0 remains L01 PASS/L02 escaping-parent FAIL; two Workers/two guest entries, nine Worker/eight guest slots UNRUN. K1-K4 partial. No original error descriptor was captured.

Separate parent-only probe 4d7f8531dc72a8006e9f8548cddbf0a181595621: exact recognized compiled FsError for /missing has own stack accessor (get/set), own message/code/errno/path/syscall/name data, own undefined dest. Original typedErrorDTO rejects stack and rethrows the identical error. New probe stdout SHA256 ffa54aa2db858dfa037c2404a374e5e70c005030d1e1ed2ab3349412384cd821; Node22 pinned; one parent natural exit0; seven dynamic loads, twelve edges; no engine/Worker/guest/compiler. Stack was not read. This proves the new parent representation mismatch; its explanation of original L02 is source inference, not recovered original detail.

## Minimal candidate

candidate/errors.mjs changes ONE predicate: recognized native stack metadata is opaque/non-DTO and may be an accessor. It is never read/copied/transported. All other own-key/type/accessor checks, required/optional fields, extra/symbol rejection and recognizer remain unchanged. The FS-operation-only gate and terminal-independent reconciliation are byte-identical. This is not arbitrary accessor acceptance in transported records. Genuine provider matching is not replaced by synthetic test branding.

COMPOSITION.json contains all124 exact source/emission/metadata bindings; errors.mjs plus three metadata files differ. MODULES retains116 records/300 edges,95 compiled outputs unchanged. Candidate/ sibling copies of wire/json-size/parent-rpc/reservations are exact DATA harness inputs, not additional executable changes in the future capsule. The full original archive remains reachable; no new engine copies/builds.

## Finite controls

PRESEAL af14d6304cb384bfb7b2f79caabc3c9d69b761898ebdf525828087600ffbdecc:18 strict descriptor/observer/identity controls plus5 composed actual parent-rpc controls. Synthetic owner/provider are explicitly test local, not actual Worker/guest/VFS success or public preallocation proof. Actual wire/SAB metadata and actual RPC functions run without a Worker; model cleanup is not a real Worker-exit proof. Whole supervisor missing-terminal call remains source-only; direct RPC reconcile is dynamic. No compiled FsError re-probe.

After commit, literal local launch.mjs run('af14d6304cb384bfb7b2f79caabc3c9d69b761898ebdf525828087600ffbdecc') launches one pinned Node control child. Raw capture before input/tool admission; no network/private/engine/compiler/Worker. Max5min/6children/peak3,16MiB capture128MiB work, stricter30s+2s kill control. No retries. All failures preserved. Prepare/publication starts reported separately.

## Diagnostic capture and remaining hold

observe.mjs is bounded trusted-host observation: proxy refusal before recognizer/reflection, recognized-only own-data name/message/code/errno/path/syscall/dest (1024UTF8 bytes each), at most16 keys, no stack/cause values/getters or ambient values. An observation failure is returned as data; it cannot replace the caller's retained raw reason, including undefined. The helper is tested separately and does NOT yet add an automatic Worker-side/parent-entry publication path. No original receipt schema is relaxed. A future outer-owner invocation must preseal the exact supplemental capture/publication seam and retain raw primary plus secondary capture failure; it is an explicit continuation blocker, not a claimed completed live observer.

PROFILE.json retains all original11Worker/10guest ceilings and stricter limits; actual admission0. Different review and fresh ROOT continuation GO required; no old9 autoGO. F05/privateABI8 deferred unchanged; originalNP1 HOLD. No Node product/CLI/full compatibility/provider qualification.
