# safe-bash-command-od

Virtual `od` command implementation for `@poe-platform/safe-bash`, supporting octal, hexadecimal, signed/unsigned decimal, floating-point, named character (`-a` / `-ta`), C escape (`-c` / `-tc`), printable trailer (`z`), and NUL-terminated string (`-S`) modes with streaming bounded input.

Set `limits.maxInputBytes` (or `maxInputBytes`) to a nonnegative safe integer to bound input, or `Infinity` for unlimited input. Filesystems without streaming reads use `readFile`.
The short string option requires a length: `-S 4` or `-S4`. `--strings` defaults to 3; use `--strings=4` to choose a length. Optional width arguments must be attached: `-w16` or `--width=16`.
Traditional `od +OFFSET` and `od FILE +OFFSET` forms skip an octal byte offset; a trailing `.` selects decimal, `0x` selects hexadecimal, and a trailing `b` multiplies by 512. Modern options such as `-j` and `-t` disable traditional offset operands.

Widths must be positive. A width that is not a multiple of every selected type size falls back to the smallest common multiple with a warning (for example, `-w5 -tx4` uses 4). Repeated or combined `-t` formats have no fixed count limit. Mixed formats align by byte position, and `z` trailers align across full and partial rows.
