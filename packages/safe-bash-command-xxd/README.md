# safe-bash-command-xxd

Virtual `xxd` command implementation for `@poe-platform/safe-bash`, supporting hexadecimal, plain (`-p`), binary (`-b`), C include (`-i`), little-endian (`-e`), and reverse (`-r` / `-r -p`) dump modes with streaming bounded input.

Set `limits.maxInputBytes` (or `maxInputBytes`) to a nonnegative safe integer to bound input, or `Infinity` for unlimited input. Filesystems without streaming reads use `readFile`.
