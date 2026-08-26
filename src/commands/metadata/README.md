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

## stat

Supports `-L`/`--dereference`, `-c`/`--format` (newline per operand), and
`--printf` (explicit escapes/newlines, including raw byte octal/hex escapes).
Implemented directives: `%n`, `%N`, `%s`, `%a`, `%A`, `%f`, `%F`, `%i`, `%h`,
`%u`, `%g`, `%d`, `%D`, `%x/%y/%z/%w`, `%X/%Y/%Z/%W`, and `%%`.
Basic width, alignment, numeric zero/sign/alternate padding and epoch precision
up to three decimal places are supported with bounded output allocation.

Timestamps are deterministic UTC at millisecond resolution, not GNU's full
nanosecond rendering. The default report is a concise virtual metadata report,
not byte-identical GNU stat output. A missing birth timestamp renders `-` in
`%w`/the default report; requesting an unavailable numeric birth timestamp or
optional device/inode/owner/link-count field fails explicitly. Mode fields fail
when the backend declares permissions unsupported; the default says unavailable.
No host username/group lookup, block allocation guesses, SELinux context, mount
point or filesystem-capacity data is fabricated. Unsupported directives and
`-f`/cache policies are rejected. Quoting supports literal, shell-always and
UTF-8 shell-escape-always, not every GNU locale/quoting style.

Limits: 100,000 visited entries, depth 128, 1 MiB stdout, 64 KiB argument bytes,
128 temporary-name attempts; each can be configured under `{ limits }`.
Forward cancellation to every filesystem operation and await output writes.

Primary research: GNU Coreutils manual, chmod invocation, symbolic modes and
directory setuid/setgid sections (manual observed as 9.11 on August 26, 2026).
These are semantic references, not a claim that a GNU 9.11 executable was tested.
