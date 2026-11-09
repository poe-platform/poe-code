# safe-bash-command-sponge

Collect a pipeline before writing its output with `sponge` inside
`@poe-platform/safe-bash`. `maxBufferedBytes` defaults to `Infinity`; set a finite
value to limit retained input. Explicit `Infinity` disables the quota.

Regular file destinations are replaced while preserving permissions, so other
hard links and open readers keep the original contents. Symlinks are followed.

`sponge [FILE]` writes to the first file operand and ignores additional operands.
Use `-a` to append to that file.

When `POSIXLY_CORRECT` is set (even to an empty value), option parsing stops at
the destination: `sponge f -a` overwrites `f`, while `sponge -a f` appends.
