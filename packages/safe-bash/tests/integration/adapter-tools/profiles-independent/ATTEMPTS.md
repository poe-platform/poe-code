# Retained attempts

## Runtime: `evidence/first`

The first runtime attempt passed build, strict SOURCE input checking, SOURCE81,
offline pack, strict packed-consumer compilation, packed81, unchanged author22,
unchanged prior-independent27 and new-independent14. All three bounded mutants
failed the intended assertions; restored14 passed. No runtime test or production
fix was needed. Captured `verify.mjs` and `controls.test.ts` bytes equal the final
files. These new verifier inputs were uncommitted when executed; the target
product, canonical fixtures, helper and original controls were committed inputs.

## Historical audit: `evidence/audit-first`

Seal authentication and the retained WsgiDAV audit passed. The existing S3
provenance auditor passed six rows and failed its seventh with ENOENT for
`tests/integration/adapter-tools/remote-rmdir/README.md`: this verifier's isolated
archive omitted a transitive original-seal dependency. This is a verifier copy
setup error, not a canonical migration or product failure. Full logs and archive
remain. The runner now obtains every dependency from the unchanged original seal.

## Historical audit: `evidence/audit-second`

The corrected S3 auditor passed 7/7, and WsgiDAV auditing passed. The old one-shot
sealing script failed its immutable-seal guard, as designed. After deleting only
the isolated copy's seal, it reached its old live-original Git-diff assertion.
However, this copy still lacked original preflight and MockDav files. That attempt
alone therefore does **not** establish a surgical two-file stale assumption.
Its summary is superseded on that point, not erased or counted as qualification.

## Historical audit: `evidence/audit-third`

Both missing original files were included. The runner additionally verifies that
the isolated old-vs-current diff equals the committed old-vs-3bf diff and contains
**only fixtures.ts and matrix.test.ts** before invoking the original auditor.
WsgiDAV evidence audit and S3 7/7 pass. Both old one-shot failure stages are retained;
the second is now an authenticated stale migration assumption, not an archive
omission. No historical artifact, assertion, seal or source was changed.

## Provenance selfchecks

`evidence/provenance-first` passed 7/7. A subsequent additive assertion binds the
SOURCE run's public self-reference `source/dist` module loads to the same packed
build, in addition to the already checked `source/src` and external packed loads.
The final selfcheck is retained separately. Neither selfcheck executes a whole
historical matrix, real service or release cohort.

Read-only exploratory discovery also encountered one Node child-output ENOBUFS
while listing the repository with Node's default buffer. It was repeated with an
explicit bounded 32 MiB buffer. This did not execute tests or alter repository
inputs. It is not a product failure.
