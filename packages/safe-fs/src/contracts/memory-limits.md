# Memory filesystem resource limits

This is the #621 implementation contract. Qualification and delivery evidence
belong to `docs/plans/bugfix-621-memory-limits.md`; the contract alone is not a
passing gate or a published-version claim.

## Configuration

`MemoryFileSystem` and `createMemoryFileSystem` accept the same flat optional
`MemoryFileSystemOptions`. `createFileSystem` accepts those fields in the
`options` record for the `memory` adapter. The constructor and adapter share
validation rather than maintaining separate numeric policies.

| Option | Default | Meaning |
| --- | --- | --- |
| `maxFileBytes` | 16,777,216 | Maximum logical size of a file. |
| `maxRetainedBytes` | 67,108,864 | Accounted owned buffer capacity and retained strings. |
| `maxMetadataUnits` | 10,000 | Accounted inodes, names and active handle/stream reservations. |

`defaultMemoryFileSystemLimits` is immutable. Missing options use those defaults;
supplied options are copied and frozen. Values must be finite safe integers.
Byte limits may be zero; metadata must be at least one to admit the root inode.
Unknown fields, accessors, explicit undefined/null field values and invalid numbers are
rejected before store construction. Explicit finite overrides support larger
trusted workloads; default construction is no longer unbounded.

## Ownership and accounting

Limits belong to one backing Memory instance and persist across Shell executions,
factory consumers, mounts and aliases. A Shell borrowing a different filesystem
does not acquire authority to replace that host's storage policy.

The root consumes one inode unit. Creating a distinct child consumes an inode
unit and a directory-name unit. A hard link adds its name charge without charging
the same inode or buffer twice. Retained names, symlink targets and owned
descriptor/stream paths are charged at two bytes per UTF-16 code unit.

File buffers are charged by backing capacity, including geometric slack, rather
than only logical size. Owned old generations retained by active streams remain
charged. New allocations must be admitted before they occur; replacement peaks
include old and new owned allocations while both exist. Growth remains amortized
and is clamped to available capacity rather than repeatedly allocating an exact
one-byte increase near the ceiling.

Removing a name refunds that name, but unlinked resources held by active
handles/streams remain charged until release. Replacement, recursive removal,
close, error and cancellation must refund only resources no longer owned.
Failed admission/allocation must not leak reservations or publish an uncharged
resource. Stream failures retain the existing acknowledged-prefix semantics;
a quota is not a transaction or a rollback of completed writes.

Per-file overflow is `EFBIG`; accounted store exhaustion is `ENOSPC`.
Permissions, identity/alias comparison and descriptor-write visibility remain
independent contracts and must not be weakened to implement accounting.

## Limits of the guarantee

These are finite implementation-resource budgets, not an exact JavaScript heap,
RSS, process-memory or Cloudflare isolate limit. General runtime overhead and
caller-owned returned read/stat observations are outside this ledger. A caller
can independently retain data or allocate unrelated memory. No hard heap claim
or the originally reported 128 MiB fatal threshold follows from bounded tests.

Shell's separate `maxFileSystemOperations` allowance limits admitted API work per
execution, not stored data. Its default is 100,000 and its existing Worker preset
uses 10,000. Children share it; a later execution receives a fresh work allowance
without resetting this Memory store. Resource cleanup remains possible after
admission is exhausted. Backend-internal subcalls and delivered stream chunks
are not invented additional filesystem API calls.

Command handlers receive a metered filesystem view, not the original object's
reference. The view forwards operations to the same borrowed backing store with
the original method receiver and entry-comparison authority. It does not clone
files or replace host storage policy. Code needing to verify shared entries
should use the filesystem comparison contract rather than object equality.
