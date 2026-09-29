# safe-bash-command-od

Virtual `od` command implementation for `@poe-platform/safe-bash`, supporting octal, hexadecimal, signed/unsigned decimal, floating-point, named character (`-a` / `-ta`), C escape (`-c` / `-tc`), printable trailer (`z`), and NUL-terminated string (`-S`) modes with streaming bounded input.

Set `limits.maxInputBytes` (or `maxInputBytes`) to a nonnegative safe integer to bound input, or `Infinity` for unlimited input. Filesystems without streaming reads use `readFile`.
Optional width and string-length arguments must be attached: `-w16`, `--width=16`, `-S4`, or `--strings=4`. Separate numeric arguments remain filenames.
