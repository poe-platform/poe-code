# Private wget command ownership

## Scope

Revalidated main `62746d3fca`: `safe-bash-command-wget` already owns wget parsing,
flags, help, diagnostics and command/plugin factories, but imports the shared
transfer handler from `safe-bash-command-curl/curl`. Move that unchanged handler
into the existing private `safe-bash-network-engine`. Both frontends consume it;
wget no longer depends on curl. Keep curl's transfer export as a compatibility
facade. No new package, default command, capability or external dependency.

The network engine owns common authorization, redirect, retry, deadline, response
cleanup and VFS publication mechanics. Wget owns its download policy through its
parsed profile (resume, no-clobber, spider, filename selection and status mapping).
Canonical arguments, values, errors and IO remain owned by safe-bash-contracts.

Concurrent main commit `d26a6ea88f` delivered the identical shared transfer move
and also moved curl-specific parsing into curl. The final wget change builds on
that implementation and completes its independent boundary and consumer coverage.

## Implementation and verification

- Characterize the invalid command-to-command dependency with a failing boundary
  test, then remove it from the manifest, lockfile and exact private admission.
- Preserve the existing private workspace tests. Keep the existing Shell/network
  regression tests at the composition boundary: moving those into wget would
  introduce a forbidden dependency back to Safe Bash.
- Run the maintained Safe Bash build closure, focused wget/curl/network-engine
  unit and lint/type checks, and every active network regression file.
- Extend the memfs package fixture and maintained installed consumers. Verify
  public root/subpath declarations with strict NodeNext and actual Shell scripts,
  pipelines, byte argv, binary VFS/stdout publication, per-hop authorization,
  cancellation identity/cleanup, explicit limits and registration collisions.
- Pack only the existing shipping parents; install tarballs into an isolated
  consumer with no private packages or workspace sources. Check the portable
  browser/workerd public routes as well as Node.
- Run package-lint and review the diff. Commit the atomic extraction and verify
  its presence on remote main. Release publication is a separate CI outcome.

Output/help bytes are unchanged; this ownership refactor does not change the
visual CLI. All temporary verification output stays in out and is removed after
review. The command and supporting engine remain private and bundled through
existing Safe Bash exports.
