# Retained filesystem cleanup

`retainFileSystemCleanup(filesystem, callback, options)` captures an explicit
cleanup operation while a scoped filesystem is still open. It returns an
idempotent asynchronous close function. Register that function with the owning
invocation before starting the work whose resources it releases, and await it on
normal completion too.

The callback receives a restricted view: `lstat`, `realpath`, nonrecursive `rm`,
and `rmdir` when supported. It cannot create files, read their contents, enumerate
directories or perform recursive deletion. It must verify that the entries it
removes are still the resources owned by that invocation. Metadata checks are
not atomic leases against concurrent namespace replacement.

Normal filesystem operations continue to reject their captured cancelled signal.
Only the already-retained cleanup callback can use its restricted view after
cancellation. New registrations after cancellation and view calls after callback
completion are rejected. Close drains admitted asynchronous operations even when
the callback did not await them; retaining a view does not keep it usable after
closure. Provider and cleanup failures remain observable.

Callbacks are responsible for awaiting and handling their already-settled work.
Close does not resurrect an error the callback explicitly awaited and handled.
It waits for operations still pending at callback completion and reports their
drain failures; a callback failure remains the primary thrown reason.

## Configuration and accounting

`maxOperations` bounds callback filesystem operations, accepts 0–4096 and defaults
to 256. Zero permits a callback that performs no filesystem operations. No
environment variables are introduced. A scoped filesystem can receive a fourth
`cleanupCharge` callback, separate from its ordinary-operation charge callback.
The default uses the ordinary charge callback. A host that needs cleanup after
cancellation must supply appropriate cleanup accounting; this is not permission
to discard quotas or operation limits.

Safe Bash shares its existing filesystem-operation counter between normal and
cleanup operations. Cleanup does not reject solely because the command signal is
already cancelled, but reaching the operation limit or a provider refusal can
still prevent removal. Provider readonly, quota and backing-resource policies
remain in force. Cleanup is cooperative trusted-host work, not arbitrary
preemption, a filesystem transaction, or a host-JavaScript sandbox.
