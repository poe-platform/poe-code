# Release repair: S3 snapshot preservation controls

## Validated failure

On September 8, 2026, the focused preservation test reproduced the release
failure: two tests passed and the frozen-raw authentication test failed with
ENOENT for the deliberately removed
`tests/integration/full-gate-20260827/combined-b494675c/evidence/canonical/test.stdout.log.data.gzbase64`.
Upstream `c24153ef5` removed obsolete generated reports; those artifacts must not
be restored, reconstructed, or silently treated as authenticated.

## Bounded replacement

Replace the unavailable-raw test with a live S3 mock-backed regression. Invoke
the actual snapshot `rmdir` implementation under the old unconditional ENOTSUP
rejection predicate and require its exact `ERR_ASSERTION` / `Missing expected
rejection.` failure. Also require only the empty marker DELETE, absence of that
directory afterward, retained parents, and unchanged sentinel bytes. This is
current behavior evidence, not a replay or authentication of removed raw logs.

Keep the surviving local historical report and original fixture byte hashes,
the original workflow-input comparison, and the exact WebDAV refusal guards.
Keep the existing fail-closed snapshot-profile tamper controls and actual remote
adapter workflows. No missing-file pass/skip path is introduced.

The opt-in profile harness no longer includes the removed full-gate raw, routing,
or repository report in its required input inventory. Its surviving owned
historical fixtures remain hashed, and its fresh execution of the authenticated
old fixture must still fail with the expected rejection assertion. Sealed
historical manifests and captured data are unchanged.

## Validation ownership

Use Node 22 and the configured small TMPDIR for explicit focused test paths.
Wait for root's complete build before running canonical adapter imports; a
temporary missing root peer bundle during partial rebuilds is not a product bug
and must not be repaired with aliases or shims. Root owns full gates and release.
The opt-in evidence-writing/Git archive harness is not executed in this repair.

After root's complete build exited zero, the explicit three-file Node test run
passed. Direct Node 22/tsx execution confirmed **26/26** assertions: preservation
3/3, snapshot-profile guards 17/17, and remote workflows 6/6, with zero skips,
TODOs, cancellations, or failures. `node --check` also passed for `run.mjs`.
No Git operations, historical artifact restoration, peer shims, or product edits
were performed.
