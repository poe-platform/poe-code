# ROOT M1B decisions and author correction record

Status: Accepted ROOT decisions — AUTHOR DESIGN CORRECTIONS ONLY
Implemented Through: Not applicable
Purpose: Record the exact ROOT selections and a noninterrupting correction checklist; no new implementation or execution authority.

Date: **2026-08-28**. This additive record resolves D1/D2/D3, adopts F01/F02 and directs R01/R02 corrections. It does not rewrite the frozen author or independent-review packets. No M1B implementation, product/native/synthetic execution, tests, compiler/build, default/public integration, new limit or API is authorized.

## Bound records

Paths in this table are relative to `tests/commands/` unless stated otherwise.

| Record | Exact identity |
| --- | --- |
| Original author | `63d811bf1a809b467f47f309f41b1445486e71db`, `git-pack-design-20260828/` |
| Author design preseal | `7447166d3573eb6fa1ddcd6eb51b8e8212179033` |
| Author DATA preseal | `bacf99cb0f8c675c06c29703ff6060357957136f` |
| Independent format | `c1982fce204f65b228863c873ba6ee279525fb88`, `git-pack-independent-20260828/format/`; `SEAL.json` SHA256 `f232c59aa1f3b50dfedc3135e4d26ad880256e09ec99e656b3d5d911e0da16b4` |
| Independent resources | `9c0558b7ddf901294ea47451f292cf8eebc50837`, `git-pack-independent-20260828/resources/`; `FINAL-SEAL.json` SHA256 `cb57795bef54d5c8e3fab20ae0457c928257ff0ab3e039323588ad2d206fd137` |
| Original fixture | `git-pack-design-20260828/NEUTRAL-PACKS.json`, SHA256 `eda294f89c61d09319701c50c76e1004d2b4de27fc5d025473a4058fc75a7080` |
| Corrected author metadata | `git-pack-design-20260828/BINDING-v2.json`, SHA256 `6053a0d4f8d5ed3af819861abd4e660db662adc63b32023b4d39dee57108f9e3`; authoritative corrected metadata, not product evidence |
| M1A | `9885390fb11454fa194a3e60fdbef198dbfdf633`; eleven files remain frozen and Dirac-owned under actual review, not reviewed again here |

F01/F02 are adopted from sealed `format/FINDINGS.json` (SHA256 `079488ffcd1e12613335af69a09a4098cdd8b9144839a3a961260202b6398c4a`) and its Git2.54.0 primary-source bindings. R01/R02 retain the qualifications in sealed `resources/FINDINGS.json` (SHA256 `561f814a6b6961032ec44177f83b79cd69d94ff4e4adb6b30e9052ccf22263ab`). Earlier “pending ROOT” statements remain historical; this record supplies the selection without changing those bytes.

## Selected decisions

### D1 — EAGER before any success

ROOT selects verification of every discovered pack/index envelope, CRC, frame, delta and final OID **before any successful output**, including metadata-only queries and loose-object selection. This is an explicitly stricter **bounded pack-integrity profile**, not ordinary packed-repository readiness or performance parity, and not full fsck of unselected loose bodies. The alternative selected-object/lazy profile is not selected.

**All 24 numeric limits remain unchanged. Cumulative work can refuse packs well below the 32 MiB per-pack cap.** Preserve the static necessary-condition example: owned fill, pack hash, entry CRC and pre-publication hash give `W >= 4P-52`; at `P=8,000,014`, that is **32,000,004 byte-work units**, already exceeding 32,000,000 **before index, inflation or query work**. This is source arithmetic under the stated charging rules, not a timing result, a fit guarantee or permission to increase/reset a budget.

### D2 and R02 — exact inert sidecars, observation-only authority

ROOT selects the exact proposed allowlist from author `DECISIONS.md`, D2:

- Regular same-stem `.rev`, `.bitmap`, `.keep`, `.mtimes` **only when the complete pack/idx pair exists**.
- Regular `objects/pack/multi-pack-index` and `objects/info/{packs,commit-graph}`.
- `lstat` size **<=16 MiB**, bounded directory-entry accounting, and no followed links. Incremental index/graph directories and unknown names still refuse. **Promisor is never ignored.** No other path pattern, provider, configuration, network, hook or linked-worktree admission is added.

The observation contract is **bounded membership, type, size and available-stat observations only**. Bodies are unused and unverified. Narrow “changed sidecar” assertions to changes visible to those observations; there is **no body-byte mutation-detection claim from lstat**, no fabricated unavailable stat field and no atomic-snapshot/ABA guarantee. This decision does not require sidecar body hashing or grant an uncharged read allowance.

### D3 — invocation pinning, no eviction

ROOT selects invocation-pinned verified body owners, with **no eviction**. Release only after actual consumers and admitted cooperative work have finished; compressed pack storage is not released while a codec or borrowed view still depends on it. Preserve verification and intrinsic delta depth **per location** across OID deduplication: a global body-cache hit cannot skip a physical representation or reset its depth. No public lease/cache API is introduced. Preserve B10's original eviction clause as unfulfilled/out-of-profile under this selected no-eviction design, not as an eviction pass.

### F01 — pinned Git2.54.0 delta-program minimum

Adopt the pinned reader's **minimum four-byte delta program**: lengths 0–3 are refused. This is the selected reader-compatibility restriction, **not** a ban on empty direct objects or on zero-length reconstructed results generally. Keep the short-program counterexample and the separately qualified four-byte zero-result neighbor; no new canonical-varint restriction or whole-pack/native acceptance is inferred.

### F02 — pinned Git2.54.0 SHA1 idx2 extent

Adopt the exact pinned-reader size constraint, with checked arithmetic before allocation/conversion. For object count `N`, let `B(N)=8+1024+28N+40=1072+28N`. The idx length is `S=B(N)+8L`, with an integral nonnegative large-slot count `L`:

- `N=0`: `L=0`, so **S=1072**; no trailing large-offset slot.
- `N>0`: **0<=L<=N-1**, equivalently `B(N)<=S<=B(N)+8(N-1)`, retaining the eight-byte remainder/layout rule.

Thus `N=1,L=1` gives 1108 bytes and is refused against a 1100-byte maximum. Existing **P11, N=2,L=1, S=1136**, remains within this extent. This is **not a blanket ban on small indirect offsets**; retain them when the selected extent and existing offset/slot checks permit them. No new conditional policy or universal-format-invalid claim is introduced.

### R01 — separate accounting dimensions

Correct blanket cumulative-accounting wording: read/inflation/work and applicable invocation counts are cumulative; resident reservation is live occupancy, releasable only with actual ownership/lifetime proof; size ceilings apply to their declared individual values; delta depth is intrinsic per representation/location, not a sum or cache-miss count. Preserve the exact **24 numbers**, shared invocation budgets and distinct physical-entry versus deduplicated-OID accounting. No per-object/pack/query reset, usage refund, cap override, new Budget or private counter injection is authorized. The resource review's limit-dimension table is the correction reference, not authority for an unrelated API or scope expansion.

## Exact author correction checklist

**For Curie after ROOT relays this queued handoff.** The targets below identify clauses/functions in frozen `tests/commands/git-pack-design-20260828/`; perform corrections in an **additive author revision**, not by editing or replacing the originals. Preparing a corrected data-checker source or future control descriptor does not authorize executing it.

| Item | Frozen file / section target | Required successor change |
| --- | --- | --- |
| C01 — D1 | `SPEC.md` “Storage Admission Before Success”; `DECISIONS.md` D1 row and lazy alternative; `HANDOFF.md` ROOT decisions | Mark eager selected, not pending; retain before-any-success scope and the prominent unchanged-limit/`4P-52` cost qualification. Mark the lazy alternative unselected. Do not claim ordinary packed readiness/performance or implementation GO. |
| C02 — D2/R02 | `SPEC.md` storage admission and pre-publication observations; `DECISIONS.md` D2 row; `MATRIX.md` B11 “changed sidecar” | Copy only the exact names/conditions above. Bind membership/type/size/available-stat observations, bodies unused/unverified, and no lstat byte-mutation claim. Preserve symlink/promisor/unknown/incremental refusals. |
| C03 — D3 | `SPEC.md` “Fixed Budget and Ownership Contract” and location states; `DECISIONS.md` D3/private ownership table and no-eviction paragraph; `MATRIX.md` B09/B10/B12 | Mark pinning/no eviction selected; show owner/consumer/cooperative-work release obligations, per-location verification/intrinsic depth and dedup lifetime. Keep original eviction wording/history without giving it pass credit or adding leases. |
| C04 — R01 | `SPEC.md` “Fixed Budget and Ownership Contract”, especially blanket cumulative wording; `LIMITS.json` rules; `DECISIONS.md` ownership/preallocation table; `MATRIX.md` B10 | Distinguish cumulative/live/per-value/intrinsic dimensions and exact count sites, retaining all 24 literal values and resource masks. No numeric/default/API change or manufactured at-cap success. |
| C05 — F01 | `SPEC.md` “Delta Contract”; `check-data.mjs` `reconstruct`; `MATRIX.md` B04/B05; related future-control descriptions | Add the four-byte minimum before replay. Declare length0/1/2/3 refusals; preserve empty direct bodies and the separately qualified zero-result neighbor. No execution, original fixture mutation, new varint policy or blanket zero-result ban. |
| C06 — F02 | `SPEC.md` “Pack and Index Contract” rules2/4; `check-data.mjs` index parser `INDEX_SIZE`/large-table admission; `MATRIX.md` B07/B08 | Apply the exact SHA1 formula including N0/L0. Preserve separate N0/trailing-slot and N1/L1 refusal descriptors and N2/L1/P11 extent-positive descriptor; retain valid small indirect offsets. No original DATA score is rewritten. |
| C07 — proof labels | `SOURCES.md`; `MATRIX.md`; `NATIVE-RECIPES.md`; `DATA-RECIPE.md`; `HANDOFF.md` | Attribute F01/F02 to the pinned reader, resolve only the selected D1/D2/D3 branches, and keep source/data/product/native roles distinct. Leave six workflows and future codec/ownership/abort/type controls UNRUN. Do not alter diagnostic goldens or broaden B01–B12. |
| C08 — additive seals | Successor binding/seal/handoff corresponding to original `BINDING-v2.json` and `HANDOFF.md` | Name this committed ROOT record, exact predecessor commits and new revision paths/bytes/hashes/seals explicitly. Preserve original `BINDING.json`, `SEAL-v1-FAILURE.txt`, corrected-v2 authority, fixture/generator/check captures and independent histories; no silent rewrite, replay, rescore or pass inheritance. |

## Unchanged evidence and authorization boundary

The **38 format** and **32 resource** future-case rows and **six workflows remain UNRUN**. Author **13 format sets /106 entries /18 DATA rejects** remain author data, unreplayed here and not product/native evidence. Original metadata-v1 failure/empty binding and corrected-v2 authority remain unchanged.

The resource preparation result remains **FAIL_PREPARATION_CHECK**: a 15,000ms global ceiling was exceeded at **23,772.693625ms despite checker exit0/zero warnings**. This is a separate unchanged preparation failure, **not** a product finding, pass, waiver or rescore. This follow-up does not rerun that checker/data check or create another check attempt.

M1A stays Dirac-owned/frozen; YQ stays paused. This record grants **author design corrections only**. Source author Curie remains on the array-composition critical path: the correction note is queued for ROOT to relay **noninterruptingly**, not directly delivered, and no agent is spawned, steered or resumed. Current follow-up activity is document reads, Git metadata, scoped diff checks and this explicit-path commit only; target/test/compiler/native/private/version execution and active owned/background children are **zero**.
