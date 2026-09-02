# Bounded indexed live host objects

Issue: #545.

- Add optional indexed metadata with synchronous length/get callbacks and an explicit positive maximum length, capped at 65,536.
- Keep index dispatch inside capability metadata. Do not create native proxies or eagerly allocate per-index properties.
- Reserve length and canonical array-index names against fixed members; reject index writes and unsupported reflection/mutation.
- Expose live reads, enumerable own indices, membership, for-of, Array.from and object spread through the existing owner-checked conversion boundary.
- Preserve shallow element identity, skip removed properties during enumeration, and avoid invoking element getters for invalid/out-of-range names.
- Charge length validation, enumeration and traversal; storage accounting must not query live host callbacks or model virtual indices as allocated properties.
- Revoke access on close and retain existing explicit data-copy/replay restrictions.
- Test the public API and fresh Node/Bun/TypeScript package consumers; publish through GitHub and verify provenance before closure.
