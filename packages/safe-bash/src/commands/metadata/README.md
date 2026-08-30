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
the host or inferred from environment variables. Symbolic `X` uses the evolving
mode after preceding clauses, following GNU `mode_adjust`; BSD's original-mode
behavior differs in two retained native observations. See the explicit matrix in
`tests/commands/metadata/gnu-mode-evidence.json`. GNU directory setid preservation and explicit clearing
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
Negative fractional epochs follow the pinned GNU coreutils 9.7 executable:
fractional digits are truncated in magnitude, but a zero resulting fraction
retains the floor-second integer (for example, -11 ms gives `-1.0` at precision
one and `-0.01` at precision two). This deliberately preserves observed runtime
behavior, not the current GNU manual's contrary minus-infinity rounding rule.
Fractional epoch width also follows that executable's separate integer/fraction
formatting, including trailing spaces for narrow widths: at 1 ms, `%3.3Y`
produces `0.001` followed by two spaces. Those bytes count toward output limits.

Human timestamps (`%x/%y/%z/%w`, including the default report) use deterministic
UTC with GNU-style nine-digit fractions. `FileStat` supplies numeric milliseconds,
not a nanosecond field or a declared resolution. The renderer interprets each
finite Number's shortest round-trip decimal representation as milliseconds and
scales that decimal exactly with BigInt, rounding to the nearest nanosecond;
exact half-nanosecond ties round away from zero. Negative results normalize to
a floor-second date plus a nonnegative fraction, including second/day carry.
Date is used only for whole-second calendar conversion, never to clip the input
fraction. Values outside Date's inclusive +/-8,640,000,000,000,000 ms range fail.
This avoids floating-point whole-epoch multiplication and binary residual digits:
`1700000000123.456` ms renders `.123456000`, not `.123456055`. Integral milliseconds
pad six zeros; sub-millisecond values retain the available decimal fraction.
Nine output columns do not imply nanosecond storage or recover precision already
lost by a backend/Number. Real native nanoseconds not representable in the supplied
numeric milliseconds remain a classified comparison gap, not an exact match.
The prior three-digit human output is retained in the read-only original author
test as historical evidence; its selected-GNU expectation conflict is reported,
not silently rewritten. Epoch precision/rounding/width rules above are unchanged.
The default report is a concise virtual metadata report,
not byte-identical GNU stat output. A missing birth timestamp renders `-` in
`%w`/the default report; requesting an unavailable numeric birth timestamp or
optional device/inode/owner/link-count field fails explicitly. Mode fields report
the required `FileStat.mode` supplied by the backend, including through readonly
wrappers. A synthetic/virtual backend mode is not a claim that the provider can
enforce POSIX permissions; mutation support remains a separate capability check.
No host username/group lookup, block allocation guesses, SELinux context, mount
point or filesystem-capacity data is fabricated. Unsupported directives and
`-f`/cache policies are rejected. Quoting supports literal, shell-always and
UTF-8 shell-escape-always, not every GNU locale/quoting style.

## mktemp

Supports a template with a final run of at least three `X` characters, inferred
or `--suffix` suffixes, `-d`/`--directory`, `-p DIR`/`--tmpdir[=DIR]`,
`-u`/`--dry-run`, `-q`/`--quiet`, and `--`. With no template, use
`tmp.XXXXXXXXXX` under virtual `TMPDIR` or `/tmp`; the directory must exist in
the VFS. There is never a fallback to host temporary directories. Deprecated
`-t` and unimplemented flags are rejected. Components longer than 255 UTF-8
bytes are rejected before creation.

Names use unbiased `node:crypto` randomness, with exclusive `writeFile` flag
`wx` or nonrecursive `mkdir`, bounded retries on creation `EEXIST` only, and
0600/0700 creation modes masked by the configured virtual umask. Creation requires
declared `permissions: true`; otherwise fail before effects rather than promise
private access on a backend that cannot enforce it. Existing competing entries
are never deleted or overwritten. A dry-run only checks a generated name and
does not reserve it: using that name later is inherently racy.

Known output-size failure is checked before creation. A later sink failure or
cancellation after successful creation may leave the new entry; the command
does not attempt unsafe cleanup of a path another actor may now own. No global
namespace or parent-symlink race guarantee beyond the filesystem adapter is
claimed. Directory mode support/exclusive creation must be real backend behavior,
not merely a capability label.

Limits: 100,000 visited entries, depth 128, 1 MiB stdout, 64 KiB argument bytes,
128 temporary-name attempts; each can be configured under `{ limits }`.
Forward cancellation to every filesystem operation and await output writes.

Primary research: GNU Coreutils manual sections for these utilities and the
GNU gnulib `mode_adjust` implementation (source SHA-256 recorded with the tests).
These source references are separate from runtime validation. Bounded GNU 9.7
human-stat executable evidence, numeric-capacity gaps and the preserved original
author expectation conflict are in `tests/commands/metadata-stress/stat-human-evidence/`.
