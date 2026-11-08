# Timeout F22 receiver repair handoff

Status: author-scoped F22 repair passes; independent Raman review is required.
This does not accept the whole timeout module, rescore the prior independent
cohort, or resolve its separate verifier issues.

## Exact repair

- Independently rejected candidate:
  `9ed9a0f14d12758713a8dc42be1ff75f0c87a36f`; recipe
  `289d00d253136032c1bd6b078662ba5f37e39a3d`; evidence
  `a8ebf811c57fbb1084ccfe9dd34a8265f5dff69a`.
- Coherent baseline: `5137a74ec855a32d8a8860eb66b62eb44d11e290`,
  tree `48e5ae39ce98e1c8e416bae77da40d88b75e1db5`.
- Presealed repair regression: `72a109971d6c82f783ae91de62f7c15e2af21d8b`.
- Source-only repair: `a23867d6a42e1cb2f2e7278cf22061737a4bea9d`.
  The sole product edit changes the default scheduler binding's `receiver` from
  `undefined` to the imported `performance` object. The scheduler blob changes
  from `d49ef949bc6189b5b32536b8750c34db85a7f909` to
  `a5839e09b810b88dd340e4b36ff4b100533e481b`; the other three timeout blobs
  remain those of `9ed9a0f`.

Fresh prepatch capture on Node v22.22.2 observed status 125 in both direct and
actual-Shell routes, no child admission, exact stderr
`timeout: timer setup failed\n`, registered cleanup settlement, zero retained
Timeout resources, and natural process completion. The independently executed
run did not retain its original stderr or caught exception; those bytes remain
unrecovered. The recorded `TypeError`/`ERR_INVALID_THIS` is a separately labeled
fresh direct Node receiver diagnostic, not original or product stderr.

## Reconstructed qualification

The deterministic 268-entry archive combines the coherent base, the original
README/duration/index blobs, and only the repaired scheduler blob. Its SHA-256
is `ee7fae20f2c3f99839893afe31b93aa4b6633e1baa36cfbde465e0394161de56`
before and after execution. Exact post-run source inventory comparison covers
new entries as well as mutation and removal.

The exact package is 736,430 bytes, 857 members, SHA-256
`e6f42dbb063044c0a0d9eaa3029ee9ef0b9ed26aabafd42c9346b18e1901c80c`.
Build and strict selected types pass. Runtime checks pass 81/81: F22 repair 2/2,
unchanged author 14/14, sleep neighbor 27/27, and shared cleanup neighbors
38/38. The unchanged author cases retain same-sentinel parent priority and the
activated same-sentinel retirement failure.

Offline installed and physically moved internal consumers each return default
real-clock child status 7 through an actual Shell. Both also pass the exact
custom scheduler receiver, captured-method, cancellation 124, and registered
cleanup controls; installed internal module/type hashes remain identical after
the move. The old scheduler, source-archive, and package hashes are negative
binding controls and are rejected for this repair.

Root timeout exports and the package subpath remain absent. The default registry
remains exactly 77 commands without `timeout`. Native and SafeJS executions are
zero. The original independent result remains 31/34 in each layout and was not
rerun or rescored; F01, PC01, A09, and the unexecuted independent tail remain
outside this repair.

`evidence-v1/EVIDENCE-SEAL.json` has SHA-256
`638f9e1ca1f0fb61477c1e556b891437d393b0640a69e894fb292d2320acd9c4`
and binds 41 files with manifest SHA-256
`62955bea357c709aa2668a29e4d4a1b6b729dd330eca0007a8c0328d6442c17b`.
The committed verifier checks the complete sealed listing and therefore rejects
changed, missing, and appended entries.

No remaining timeout-module product defect or execution blocker is known from
this bounded author qualification. Root should route the repaired candidate to
Raman for independent review; this author did not launch or claim that review.
