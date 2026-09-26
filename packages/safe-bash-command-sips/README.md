# `safe-bash-command-sips`

Zero-dependency `sips` (macOS Scriptable Image Processing System) and `identify` commands for `@poe-platform/safe-bash`, powered by `@poe-code/image-ast`.

## Commands

- `sips`: Query image properties (`-g`, including XML-escaped `allxml`), set/delete properties (`-s`/`-d`) across VFS reads and copies within the running process, resize (`-Z`, `-z`, `--resampleWidth`, `--resampleHeight`), crop (`-c`, `--cropOffset`), pad (`-p`, `--padColor`), rotate (`-r`), flip (`-f`), and convert formats (`-s format`, `-s formatOptions`, `--out`).
- `identify`: Inspect image format, geometry, bit depth, color space, and channel statistics (`identify [-ping] [-format ...] [-verbose] <file>...`).
