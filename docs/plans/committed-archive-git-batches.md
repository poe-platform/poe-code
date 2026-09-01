# Batch committed archive reads without weakening admission

The S3 export integration verifier spawns Git twice for every committed input.
Replace per-object calls with one bounded metadata batch and serial bounded body
batches. Preserve ordered object identities, types, exact sizes, framing, hashes,
per-input/aggregate budgets and owned byte copies. Authenticate bootstrap authority
and manifests before requesting product-source bodies. Held paths remain metadata
only. No evidence, revision selection, product behavior or concurrency changes.

Validation:

- All 91 original archive controls pass: 124.575s before, 68.442s afterward.
- All 35 new admission/framing/budget controls pass. Invalid authority/manifests
  explicitly prove that no product-source body request occurs.
- Pinned-root admission ABBA means: 21.692s before, 0.563s afterward, with identical
  318-file inventories. Metadata/body Git processes drop from 636 to three.
- Reject malformed metadata, missing/truncated/reordered bodies, wrong hashes,
  duplicate paths, count/size overruns and trailing bytes. Retain binary, empty,
  repeated-object and SHA-1/SHA-256 positive controls.
- Run the complete exports route, including the actual committed packed root,
  before delivery; focused synthetic controls are not release qualification.

Parent verification passes all 126 controls. The actual-root case correctly
refuses the pending, uncommitted security lockfile update because its workspace
lock differs from HEAD. Commit that independent lock update, then rerun the real
packed-root case rather than weakening this binding check.

After the independent lock update is committed, the actual packed-root case passes
in 46.441s (47.057s process duration). All 126 controls and the real-root route
are now verified, without bypassing the committed-lock binding.

Earlier tool-byte-cache and Git-template experiments were discarded after their
measurements showed marginal or negative benefits. No such cache is included.
