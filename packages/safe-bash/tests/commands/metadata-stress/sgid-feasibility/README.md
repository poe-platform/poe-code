# Historical SGID feasibility archive

**No permission API is implemented or approved. Root's request to
Poincare/Curie remains unresolved. All six original SGID compatibility failures
remain unresolved.** This is read-only historical proof, not a source fix,
acceptance waiver, new passing parity corpus, or a current whole-product audit.

The six `safe-bash-metadata-sgid-*` files are byte-exact copies of the requested
`/tmp` artifacts, which remain intact. `MANIFEST.json` records source paths,
lengths and SHA-256 hashes; copying used `apply_patch` and equality was checked
against the original bytes. `support/` preserves the already-existing primary
source verifier/result and two native instrumentation C sources, without editing
their filesystem-test originals. No binary, native fixture tree, or dependency
is included. The `.log` worker transcript is inventoried/hashed but not copied;
it is not in the report's reproduction artifact list. The final check, artifact
hashes and official primary-source URL/hash appendix are already part of the
copied feasibility report. No separate final/appendix report was found in the
inspected `/tmp/safe-bash-metadata-sgid-*` file inventory.

## Evidence boundaries

- Historical replay/control HEAD: `29a61222a8744ce479601ff33061a38b4a193b78`.
  Historical final recheck HEAD: `90cbf287b8533c2dad9211d87d6cb66290a80132`.
  The snapshots retain all **97** consumed file hashes and their shared digest
  `1ae6a983ac29a446d4f5f9a444428b164e2ef171adba66a2813c57ddc63cc121`.
  They describe the prior moving worktree, not this archive's commit.
- Exactly six original cases: GNU returns status 1 with original modes and
  metadata unchanged; Node/RealFS/metadata return 0 with mode `0707`. MemoryFS
  returns 0 with `02707`. RealFS counterparts are the same six inputs, not six
  additional bugs. The prior `135/141` and `165/177` cohorts stay historical.
- Four original positive scenarios / 24 layer observations are separate from
  three extra native scenarios / 12 layer observations and 14 deterministic
  command-boundary controls. None are added native-parity acceptance passes.
- All negative controls remain: readonly, unsupported capability, missing chmod,
  optional identity/ownership absence, caller/pre-dispatch and backend abort,
  injected EPERM/EACCES/EIO/ENOTSUP, stale identity, same-inode concurrent mode,
  replacement after freshness checking, and mutation-then-abort fulfillment.
  The last three characterize unsafe concurrency/cancellation boundaries;
  they do not demonstrate leases, race protection, rollback or cancellation of
  effects already made. Do not relabel their recorded success as safety.
- Official pinned Apple, libuv, Node and GNU source URLs/hashes remain in the
  report, `controls.json`, and `support/source-proof.json`. Runtime evidence is
  separate: pinned GNU 9.7 executable/version, exact argv and byte output,
  Node/libuv/kernel/credentials, before/after metadata, native instrumentation,
  ACL/flag observations and measured effects are retained in the replay JSON.
  There is no signed shared-cache/kernel validation or universal ACL proof.
- Original fixtures were sentinel-checked and removed; active owned children
  were zero. These are preserved historical cleanup observations. This archive
  did not rerun native mutation, recreate fixtures, or change SGID behavior.

## Current API blocking design boundary

The existing stat/lstat/chmod-only contract does not supply an atomic backend
permission-authority operation matching this GNU/Darwin syscall behavior while
preserving raw Node chmod. Metadata postchecking, rollback, retries, ambient
identity preflights, blanket SGID denial and capability downgrades do not close
the six status-and-effects failures safely. The report's minimum backend-owned
request is **a design question, not an approved API**. No subprocess, addon,
private binding, host fallback, new dependency or FS/contract change is delivered.
Legitimate positive permission workflows must not be disabled to hide failures.

## Replay restrictions

The archived `.mjs` scripts intentionally preserve original absolute imports,
native source references and `/tmp` destinations. They are historical artifacts,
not automatically run tests. The replay refuses an existing output; the controls
script references that output. Do not overwrite or delete the originals to run
these copies. A separately authorized replay must use a newly owned destination
and preserve this archive, pin checks, fixture isolation and cleanup. The source
verifier can fetch external URLs; archiving it does not execute it or claim a new
source capture. The lightweight archive test only reads files/hashes/JSON.
