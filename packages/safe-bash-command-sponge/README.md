# safe-bash-command-sponge

Collect a pipeline before writing its output with `sponge` inside
`@poe-platform/safe-bash`. `maxBufferedBytes` defaults to `Infinity`; set a finite
value to limit retained input. Explicit `Infinity` disables the quota.

Regular file destinations are replaced while preserving permissions, so other
hard links and open readers keep the original contents. Symlinks are followed
without replacing the link. Like moreutils, `-a` appends only to regular file
destinations: through a symlink, it overwrites the target with stdin instead of
retaining the target’s old contents. Dangling symlinks create their target.

`sponge [FILE]` writes to the first file operand and ignores additional operands.
Use `-a` to append to that file and `-h` to print usage. Options use moreutils
short-option parsing: unknown letters print diagnostics and processing continues.
Long options such as `--append` and `--version` are not recognized as aliases.

When `POSIXLY_CORRECT` is set (even to an empty value), option parsing stops at
the destination: `sponge f -a` overwrites `f`, while `sponge -a f` appends.

Omit the file operand to write to stdout. A literal `-` operand names a file
called `-`, including with `-a` or after `--`.
