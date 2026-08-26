# Metadata commands

`metadataCommands(options?)` registers the delivered metadata commands;
`createMetadataCommands(options?)` returns definitions. Registration preflights
collisions; `{ replace: true }` explicitly replaces existing definitions. This
author increment is separate from independent verification and broad GNU parity.
No runtime dependency, native process, implicit host filesystem or host umask is
used by the commands.

## chmod

Supports octal and operator-octal modes; symbolic `u/g/o/a`, `+/-/=`, `rwxXst`,
permission copies and sequential clauses; `-R`, `-v`, `-c`, `-f`,
`--reference=FILE`, their documented long spellings, and literal operands after
`--`. Leading-minus modes require `--`. Reference files and command-line symlinks
are dereferenced; descendant symlinks are not followed. Backend permissions are
required (`chmod` method and no explicit `permissions: false`); unsupported
backends fail rather than claiming a mode change. Permissions/ownership
enforcement and special-bit restrictions remain the backend's responsibility.

The default virtual umask is 0022, configurable with `{ umask }`, not read from
the host or inferred from environment variables. Symbolic `X` uses the original
mode of each operand. GNU directory setid preservation and explicit clearing
forms are covered by documentation-derived tests. Ordinary numeric/symbolic
cases are also checked against local native chmod; this is not a pinned GNU
binary certification.

Recursive root changes are refused. Restrictive directory updates are delayed
until after their children to avoid removing traversal permissions early.
Operation ordering/verbose byte formatting is not universal GNU parity.
Traversal is bounded and may have partial effects before an error; no rollback
or descriptor-relative race guarantee is claimed. Rechecking type/inode/device
detects some substitutions, not every concurrent namespace race. `-H/-L/-P`,
symlink-mode changes and root-protection overrides are not implemented and are
rejected rather than silently ignored.

Limits: 100,000 visited entries, depth 128, 1 MiB stdout, 64 KiB argument bytes,
128 temporary-name attempts; each can be configured under `{ limits }`.
Forward cancellation to every filesystem operation and await output writes.

Primary research: GNU Coreutils manual, chmod invocation, symbolic modes and
directory setuid/setgid sections (manual observed as 9.11 on August 26, 2026).
These are semantic references, not a claim that a GNU 9.11 executable was tested.
