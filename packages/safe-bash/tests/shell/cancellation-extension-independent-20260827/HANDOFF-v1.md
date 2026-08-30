# ROOT handoff — bounded review complete, candidate rejected

Candidate `373437cf84424939e1792470805cdd9e60bd3898` has B01: authenticated
budget/pipeline control failures are replaced by outer invoke cancellation in
the new runtime selector. Expected `control-failure`; actual `outer-cancel`.
See `BUGS-v1.md` and `REPORT-v1.md`. No source patch; ROOT routes to author.

- Independent freeze: `cbed682564e1e3b1c2ac8062157ece7b8b997f30`.
- Evidence commit: `8e62751d4b3b05cb493bed79aa1fd535df251da8`.
- Evidence manifest SHA-256:
  `02b99df59034dfb65ae53a2c47895dabc9b70b30e05bac01dc78baec1917acd5`.
- Postcommit raw-path proof SHA-256:
  `0647b0d4e0764ceb36cad46170de8ce245f2f00cb5b4d8d4034e2f4f3d3fa558`.

New extension 11/12 in isolated-built and moved modes, same E07 failure.
Unchanged original independent 12/12 and nearby 4/4 in each mode, separately.
Positive types pass; original six and extension eight negative rows each produce
the exact targeted diagnostics. Four targeted counterfactuals are killed using
candidate-passing witnesses. Moved/diagnostic/declaration-binding repetitions
are not extra unique controls. All original red reports and repair evidence remain.

Both read-only verifiers pass. The evidence commit reconstructs 207 changed paths,
all owned, and authenticates all 213 owned members at that commit. Its parent is
`2bfeb0e12e342c34cd163f2453c9edd8d0190630`; concurrent foreign commits are not
reinterpreted as reviewer edits. The enclosing audit commit adds only this handoff,
COMMIT-AUDIT-v1.json, the compressed commit proof and its two capture logs; its own
hash is reported by the final caller response, not embedded recursively here.

Scratch is removed. Foreign staged edits remain empty; full raw index movement is
explicitly reconciled to concurrent HEADs. Infrastructure mistakes remain versioned.
This is a post-candidate, pre-inspection frozen helper review. TEST-LOCAL registrar
coverage is not Runtime proof. R08/InvocationCancellationOwner remain design-only.
Runtime Stage2 is NOT authorized. Stop here pending ROOT routing.
