# npm pin diagnosis v1 — DATA correction candidate, NO GO

Confirmed domain mismatch, not preserved-inventory drift. All 2,039 archived originalRows equal the preserved HOLD inventory byte for byte after the documented canonicalization. The old pin hashes 2,027 copied rows, excluding exactly 12 symlink tuples. No mode or regular-content inventory delta exists.

- Full canonical UTF-8: 249,034 bytes, SHA-256 76ddb347ab8dce68f6ce84513b57e6489eb5f4a6492a87748db863ef11f9be55.
- Copied canonical UTF-8: 248,103 bytes, SHA-256 dddb66e1a4d791167c74de1226a4a1263be7485302658eeb7d3ce800c0636d9d.
- Two positive controls pass; seven finite negative controls reject. These are DATA-only controls, not product acceptance.
- DIAGNOSIS.json records exact immutable receipt/source anchors, all symlink deltas, raw failure, hash cascade, approval boundary and limits.
- The two base64 artifacts decode to exact canonical JSON bytes without a newline.
- proposed/*.data are mechanical candidate materializations only. Original packet/source/seal/GO/PARENT/HOLD files remain unchanged.
- New packet or explicit overlay binding approval and coherent source authentication are required before any later dispatch. No fresh GO, retry, future run directory or permission change is authorized here.
- 42 author / 13 independent / 93 unrun remain unchanged; zero actual dispatch.
- CORRECTION-SEAL.json is a fresh additive DATA seal for different review, not an execution authorization.
