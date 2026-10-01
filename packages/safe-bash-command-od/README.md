# safe-bash-command-od

Virtual `od` command implementation for `@poe-platform/safe-bash`, supporting octal, hexadecimal, signed/unsigned decimal, floating-point, named character (`-a` / `-ta`), C escape (`-c` / `-tc`), printable trailer (`z`), and NUL-terminated string (`-S`) modes with streaming bounded input.

Set `limits.maxInputBytes` (or `maxInputBytes`) to a nonnegative safe integer to bound input, or `Infinity` for unlimited input. Filesystems without streaming reads use `readFile`.
Optional width and string-length arguments must be attached: `-w16`, `--width=16`, `-S4`, or `--strings=4`. Separate numeric arguments remain filenames.

Widths must be positive. A width that is not a multiple of every selected type size rounds up to the next common multiple with a warning (for example, `-w5 -tx4` uses 8). Repeated or combined `-t` formats have no fixed count limit. Mixed formats align by byte position, and `z` trailers align across full and partial rows.
