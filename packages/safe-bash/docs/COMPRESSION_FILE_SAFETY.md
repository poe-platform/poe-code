# Compression file-output safety

The shared gzip, bzip2, xz and zstd command implementation uses the supplied
virtual filesystem. This describes the named-file publication and cleanup
contract, not native command-line parity or public package export qualification.

## Required capabilities

Named output requires streaming reads/writes, exclusive stage creation, safe
`rmdir`, and trustworthy entry identities (`identityScope`, `dev`, and `ino`).
An absent destination requires positive `atomicRenameNoReplace`; publication
uses `rename(..., { noReplace: true })`. An existing destination still requires
the command's force policy and positive `atomicRename`. A provider supporting
only atomic no-replace rename can therefore create new outputs without also
claiming atomic replacement.

Before each staging-directory acquisition, the command queries that actual
candidate path with `create: true` and `allowDirectory: true`. A path advertising
`snapshotRmdir: true` is explicitly unsupported: successful snapshot-empty
marker removal does not guarantee directory absence. The aggregate capabilities
are used only when no path-specific query is available. An aggregate snapshot
profile may still serve a staging path whose own contract guarantees strong
`rmdir`. There is no post-cleanup absence guess or recursive fallback.

There is no exclusive-copy fallback. Exclusive copy can expose a partial
destination if copying fails and does not establish atomic publication.
Providers without the necessary positive capabilities receive `ENOTSUP`
before stage acquisition. Stdout operation does not require file-publication
capabilities. Capability and identity checks do not make a provider's promises
stronger than its actual implementation.

## S3 automatic named-output restriction

This is a breaking restriction for `S3FileSystem`: automatic named-file output,
including `gzip -k /input` and `gzip -d /input.gz`, now returns `ENOTSUP` before
stage acquisition or publication. Its declared contract lacks scoped stat
identities and atomic rename, and its directory removal is snapshot-marker-only.
Conditional object copy does not satisfy the stronger file-output contract.
Keeping the source with `-k` does not remove the publication/cleanup requirements.

Named reads and explicit stdout/redirection remain supported:

```sh
gzip -c /input > /input.gz
gzip -dc /input.gz > /restored
```

These commands retain their inputs and use ordinary VFS redirection, not the
automatic named-output transaction. Redirection does not acquire an atomic
publication or rollback guarantee from this command; failures can leave
destination effects. This is not unchanged S3 automatic named-file compatibility.

## Ownership and cancellation

Planning and named-file work register cooperative invocation cleanup before
their first filesystem operation or resource admission. Closing a file
operation synchronously closes admission and signals its private child scope;
it does not abort the borrowed caller signal. Registered cleanup and normal
completion share an idempotent retirement promise.

Retirement covers admitted planning calls, source iterator creation and reads,
streaming writes, and stage cleanup. An admitted source returned while its
factory cancels is still retired, without issuing a new read. Outstanding
cooperative work must settle before registered cleanup completes. Actual Shell
`exec` and `dispose` therefore wait for these owned resources; direct hosts may
omit the registration hook, but the command still awaits its own cleanup.
Caller cancellation keeps its original reason, including falsey values.

Source retirement awaits the iterator's cooperative `return`, not an opaque
outstanding `next` promise after that retirement completes. Late rejection stays
observed, and late results are not inspected or published after closure. This
does not detach admitted filesystem calls, streaming writers, or retained cleanup.

The child signal inherits the caller's registered yield checkpoint through the
shared internal signal helper. Existing filesystem-operation and retained
cleanup budgets remain attached to their original filesystem scope. This change
does not introduce new codec limits or claim that every host allocation or
arbitrary provider task can be forcibly interrupted.

## Publication and cleanup

The command creates a private sibling directory and an exclusive stage file,
records scoped entry identities, validates the output, rechecks source and
destination state, and publishes by the appropriate atomic rename operation.
Source removal remains after successful publication and successful cleanup,
unless the command's keep policy applies. No source mode/timestamp restoration
or native filename-policy change is part of this safety correction.

Retained cleanup uses an independent five-second signal and at most eight
filesystem operations. It can clean known owned entries after the invocation's
ordinary filesystem scope closes. It removes the identified stage file
non-recursively and the directory with `rmdir`; it never follows an empty
directory listing with recursive removal. A late foreign child causes refusal
and remains in place.

If creation succeeds but cancellation or a provider failure prevents a
trustworthy identity snapshot, cleanup refuses to remove the unidentified path.
Unknown or replaced identities may leave artifacts for inspection rather than
risk deleting another owner's entry. These checks are not handle-relative
transactions or a general solution to namespace replacement races.

Native compression presets, compressed framing, prompts, suffixes, stdout
error-prefix behavior, and other compatibility findings remain separate from
this file-safety correction.
