# Bounded S3 namespace for Python cleanup (#749)

The flat-key S3 adapter cannot atomically remove a directory tree against a
retained identity. Keep that refusal. Add an explicit, separate namespace
profile backed by one bounded manifest object, with every mutation committed
using the store's verified conditional PUT. It must never list or delete an
arbitrary bucket prefix or infer ownership from a matching pathname.

Persist file contents, directory membership and monotonically allocated inode
identities in that manifest. Each successful conditional PUT is the namespace
mutation's linearization point. Conditional tree removal verifies both directory
and parent identities in that same transaction. Concurrent replacement or rename
must fail rather than deleting a different incarnation. Authentication and store
authority remain host-owned. This profile deliberately does not implement ZIP
staging/publication or change the excluded issue 731.

Reuse the existing immutable-version file descriptor adapter for bounded Python
binary I/O and explicit conditional publication. Detached reads retain their
snapshot; conflicting writes fail instead of overwriting another incarnation.
Do not advertise POSIX inode-following writes, symlinks, hardlinks or permissions.

TDD must cover conditional-store refusal, namespace/schema and byte bounds,
concurrent clients, replacement races, cancellation, exceptional tempdir exit,
readonly/quota/mount policy, descriptor retirement and ordinary binary workflows.
Before release, qualify a fresh standalone artifact with actual Python and a
real S3-compatible HTTP service. Mock conditional writes are not service proof.
Document all limits and the incompatibility with direct flat-key access.
