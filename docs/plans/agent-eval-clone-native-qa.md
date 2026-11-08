# Native Git clone QA

Use an owned directory under `out`, local repositories only, and the public
`cloneTarget` implementation. Keep the parent Git configuration and environment
unchanged. Remove the owned repositories and process wrappers after verification.
These checks exercise real Git and filesystem behavior outside fast unit tests.

1. Create a bare repository with branch `main` and two commits. Clone `main`
   without a cache. Check that the returned SHA and destination HEAD equal the
   remote HEAD.
2. Clone the same remote twice with a shared cache and different destinations.
   Check both returned SHAs and confirm that the cache contains exactly one bare
   `.git` repository.
3. Delete the first destination and clone it again with the same cache. Check its
   HEAD and confirm that Git prunes obsolete worktree registration and reuses the
   same bare repository.
4. Keep a third commit outside the original remote. Populate the cache, push the
   third commit to the remote, then create another destination from the cache.
   Check that the returned SHA and new HEAD equal the third commit; this requires
   fetching the updated remote before adding the worktree.
5. For an uncached clone, use an owned Git wrapper that creates the destination
   and waits when invoked with `clone`. Abort while it is waiting. Check rejection
   and absence of the destination, then retire only the owned wrapper and child.

The corresponding unit cases use memfs and the Git process boundary to verify
argument forwarding, cache reuse, fetch/prune/add ordering, SHA resolution, abort
forwarding and destination cleanup without creating repositories on disk.
