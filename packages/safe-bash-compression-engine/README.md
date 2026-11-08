# Streaming compression for Safe Bash

Safe Bash's compression commands and archive readers share streaming codec,
decoded-byte accounting, virtual-file staging and cleanup infrastructure.
The engine includes authenticated JavaScript codecs for bzip2, XZ/LZMA and
Zstandard, plus gzip streaming through the existing office-package codec.

Use the public Safe Bash command collections, or select the XZ family with
`createXzCommands` from `@poe-platform/safe-bash/commands/xz`. Existing byte-command
options continue to configure the optional decoded-byte limit.
Codec I/O uses 64 KiB windows; those windows do not limit total input or output.
Caller cancellation, awaited writes, producer ownership and staged-file cleanup
retain their existing contracts.

This is an internal private workspace. Its code, codec assets and upstream notices
are bundled into the existing shipping package, with no standalone installation,
native process execution, runtime network access or additional external dependency.
