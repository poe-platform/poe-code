# Issue 672: closed private archive dependencies

## Scope and contract

Extend the existing committed-archive verification without weakening its Git blob,
archive, canonical-peer, export, file-ownership, or execution-budget checks.
The only admitted nonempty runtime dependency set is `@noble/hashes` at `2.4.0`
and `pako` at `3.0.1`. Historical dependency-free fixtures remain supported.
Require the reviewed lockfile version, package versions, registry URLs, and SHA-512
integrities. Reject unknown, missing, ranged, aliased, shadowed, linked, or
transitively dependent packages and install hooks.

## Implementation

- `packages/safe-bash/tests/integration/s3-http-exports/committed-archive.mjs`:
  recursively mirror exact export condition keys, including nested `types` and
  browser conditions; authenticate the two published tarballs; stage only their
  authenticated regular-file inventories; recheck owned tarballs and installed
  file membership and hashes. Retain existing archive parser and path budgets.
- Resolve tarballs from their exact npm content-addressed cache locations under
  the OS account home, or explicitly supplied artifact paths. Never copy host
  `node_modules`, use a broad dependency fallback, or fetch during offline install.
  Missing verified artifacts fail closed.
- `packages/safe-bash/tests/integration/s3-http-exports/verify.mjs`: stage verified
  declarations for the isolated build, pass the owned tarballs explicitly to the
  cold offline install, and bind reachable runtime imports only to declared
  dependency exports and their authenticated files. Preserve existing root S3
  HTTP and canonical-peer checks.
- `packages/safe-bash/tests/integration/s3-http-exports/archive-controls.test.mjs`:
  add memfs contract, provenance, ownership, tampering, and runtime-binding
  controls; use the established disk archive fixture for a real offline npm
  install and the three existing isolated committed-build profiles.

## RED to GREEN evidence

Validated the old guard rejecting the current dependency manifest with
`runtime dependency: dependencies` (`2 !== 0`). Focused controls also exposed
the missing artifact helpers and recursive export mirroring. Synthetic builds
that actually import both libraries then failed with TS2307: the root builder
did not admit their declaration roots. Root fixed that admission separately;
this implementation did not bypass its guard.

On September 8, 2026, the final selected archive suite passed **21/21** in about
14 seconds using Node 22.22.0 and the required small temporary directory:

```bash
export TMPDIR="$(cat /tmp/kamilio-669-test-tmp.path)"
export PATH="$(cat /tmp/kamilio-toolchain.path)/bin:$PATH"
node --test-name-pattern='private archive dependency|archive peer contract|committed export mirroring|private archive offline installation|synthetic committed package passes' packages/safe-bash/tests/integration/s3-http-exports/archive-controls.test.mjs
```

This includes the real offline private-package install with both approved
tarballs and runtime imports, plus all three existing synthetic committed
build/pack/offline-install/runtime/types profiles: explicit packed canonical
peer, checkout canonical peer, and checkout legacy declarations. Unknown or
mutated contracts, provenance, bytes, extra files, symlinks, hardlinks, and
nonexported dependency paths are rejected by focused controls.

## Ownership and handoff

No new test file requires registration. Root already updated recursive export
mirroring and exact dependencies in `scripts/integration-inputs.test.mjs`.
Root owns product exports, manifests and lockfile, declaration admission,
public-consumer migrations, commits, and the full build/lint/test and packed
public acceptance gates. The passing synthetic profiles are not release
qualification or proof of the actual committed public browser artifact.

Archive helper implementation and focused validation are complete and frozen;
no broader audits or unrelated edits are part of this handoff.
