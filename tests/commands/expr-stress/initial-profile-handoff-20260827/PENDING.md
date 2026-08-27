# Pending exact-assertion review — separate from historical evidence

At the initial inspections neither requested v3 receipt existed:

- `/tmp/expr-sink-migration-author-v3-20260827-candidate.txt`
- `/tmp/expr-sink-migration-independent-v3-20260827-result.txt`

At the final precommit inspection the **author-only candidate receipt arrived**;
it is preserved verbatim as `AUTHOR-RECEIPT.txt.data`, with its byte hash in the
manifest. It explicitly says frozen expectations are ready and replay evidence
is pending. It names canonical test-only commit
`860967af44b20918e3096230f6c7445d4c9cf133`, author MANIFEST SHA-256
`d56c505a01e29a25707173d7ff31ee39fa042748b0f7758427b98a27cc034bb3` and FREEZE
SHA-256 `181ed1873e06a1c2848d57d5a14dd20b73e73b605387d87a701e7efab4e5618a`.
Those are author-reported bindings, not this leaf's independent replay verdict.
The independent result receipt is still absent at that inspection.

The author and different independent reviewer were assigned separately. This
leaf does not wait for completion, infer results from concurrent commits, recast
an author receipt as independent proof, or edit their files. Accepted product stays
`c3e40f8bd721da5e496f3b3abfd51aee45db5a84` with c25 quota semantics.

Root may append a separately committed synthesis here (and update the handoff
manifest) after reading actual results. Completed acceptance remains **PENDING**:

| Required binding | Status |
| --- | --- |
| Exact author fixture-only commit, paths, original/new assertion hashes | Author candidate receipt only; final evidence/review PENDING |
| Frozen original/versioned assertion and corpus identities | Author-reported hashes retained; independent qualification PENDING |
| Different reviewer's exact commit, accepted source/package binding | PENDING |
| Actual unchanged and versioned counts, bytes/status/rejection identities | PENDING |
| Preserved order/job/budget/cleanup/sink/caller assertions and remaining gaps | PENDING |
| Root synthesis of completed proof, retaining original red cohorts | PENDING |

In particular, retain the beba nearby15/16, oldquota46/47, legacy236/237 and
oldcore145/146 original results. Exact-identity replacement expectations require
separately bound review, not a blanket diagnostic waiver or relabeling old rows.
The old-cap0/1 is also historical, not silently included in sink migration.
The separately corrected shared11 276/276 does not settle these assertions.
