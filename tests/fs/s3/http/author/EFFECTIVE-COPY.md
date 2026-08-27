# Effective conditional COPY — approved August 27, 2026

Root approved the exact existing-contract review: `conditionalCopy` describes
the provided `copyObject` operation, not necessarily native HTTP COPY. This
supersedes the earlier conservative no-promotion instruction only for the
implemented, verified guarded fallback. No shared interface or legacy source
changes are included.

Native COPY enabled still requires verified native source and destination guards.
Native COPY disabled now exposes effective conditional COPY only when conditional
PUT is verified. MinIO configuration retains `verifiedConditionalOperations.copy:
false`, `delete:false`; atomic rename remains false. The original native guard
observations are still 13/17, not reclassified by this implementation.

The exact mounted same-view missing-target regression initially failed, preserving
the source and leaving the destination absent. `mounted-capability-baseline.json`
retains 67/68 and the ENOTSUP diagnostic. `effective-copy-fixed.json` records
69/69 and strict scoped type success, with stable source/fixture hashes. The extra
test covers the effective/native capability truth table. Existing source/destination
predicate, race, denial, abort, byte-limit and metadata controls remain passing.
Exclusive existing-destination copy now reaches its actual EEXIST guard, with no
PUT; missing destinations use If-None-Match:* at publication. The old 67-test,
17/18-service and conservative flag assertions remain in prior commits/evidence.

Transport SHA-256:
`452cf4192a887ecf3ec03d10471e57ebf0432dae6e58bf1150cfa54d884686ad`.
Fixed evidence SHA-256:
`88d01dea51c47e183fda1ab2ce6b9303b0c5e0f55276e139b6c0f166752f1667`.

Source ETag is checked at snapshot GET acquisition, not destination publication.
This is bounded multi-request guarded copying, not atomic server COPY, a lease,
an ABA defense or general ETag-list matching. No source deletion is introduced.

Independent service replay of the unchanged required 18 flows remains due at this
commit boundary. The public-package consumer is a separate remaining usability
gate and must use real package exports, not a patched manifest or private import.
