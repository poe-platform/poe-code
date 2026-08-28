# Independent M1B resource review: provisional decisions

Date: 2026-08-28. Design author `63d811bf1a809b467f47f309f41b1445486e71db`; design preseal `7447166d3573eb6fa1ddcd6eb51b8e8212179033`; data preseal `bacf99cb0f8c675c06c29703ff6060357957136f`. No implementation or execution approval is issued. M1A `9885390fb11454fa194a3e60fdbef198dbfdf633` remains under its different reviewer; only resource/admission seams were read. YQ remains paused.

## Root choices, still pending

- **D1:** The proposed eager-before-any-success policy is a coherent strict pack-integrity profile, not ordinary query parity or full fsck. Recommend retaining it only with explicit acceptance of the fixed-budget cost; otherwise select and freeze an exact selected-object verification scope before implementation. No automatic switch to lazy verification. With one pack of P bytes, the proposed owned fill, pack hash, entry CRC and pre-publication hash alone require at least `4P-52` charged byte operations, excluding index, inflation, result hashes and queries. This already exceeds 32,000,000 at P=8,000,014. A 32 MiB pack cannot fit two reads plus even its minimum idx under the shared 64 MiB read budget. These are static necessary-condition calculations, not timings or a successful-size guarantee.
- **D2:** Recommend the exact finite inert allowlist, not any broader storage route. Author must resolve what B11's “changed sidecar” means: lstat-only admission cannot promise body-byte mutation detection. Recommended narrow wording is bounded before/after membership, regular-kind, safe-integer size and available stat-observation checks, with body bytes unused and unverified. If body hashes are intended, explicitly specify their shared read/work/resident costs instead. No silent fallback, promisor bypass or new name pattern.
- **D3:** Recommend invocation pinning without eviction for the existing unleased internal body/message views. It requires one release authority per retained owner, location-specific verification/depth before dedup, and proof that all consumers have finished before release. B10's old eviction obligation remains unfulfilled/out-of-profile, not passed. No public lease API is proposed.

## Required author clarifications

- **R01 — accounting dimensions:** SPEC.md:144 says accounting is cumulative without excluding live resident occupancy, per-value ceilings and intrinsic depth. Narrow that sentence and bind all 24 limit dimensions. Only resident occupancy is releasable; read/inflation/work/count charges are not refunded. Path/object/pack sizes and representation depth are not cumulative sums. Numbers remain unchanged.
- **R02 — sidecar observation predicate:** Align DECISIONS.md:8 with MATRIX.md:20 as described under D2. Body changes invisible to the selected observations must not be advertised as detected; namespace/stat observations are not an atomic snapshot or ABA proof.

## Required later implementation proof, not an existing product finding

The packed codec must establish exact successful member consumption and a real owned-work cleanup barrier; public stream close notification alone must not be equated with completion of an in-flight native write. Charge-before-allocation and charge-before-work do not establish interleaved cooperative checkpoints or actual view death. Finite future cases will separate source allocation/lifetime proofs, observable output/abort/FS events, and root-choice-dependent admission expectations. No internal counter injection, cap reduction, new Budget or refund is authorized.

The format peer's provisional F01/F02 are separate compatibility findings; this leaf does not reproduce its parser review. Author fixture SHA `eda294f89c61d09319701c50c76e1004d2b4de27fc5d025473a4058fc75a7080`, 13 format sets/106 entries/18 author-data rejects and six unrun workflows remain data/history, not independent product/native evidence. Metadata-v1 failure and corrected-v2 history remain intact.
