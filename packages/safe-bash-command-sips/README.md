# `safe-bash-command-sips`

Zero-dependency `sips` (macOS Scriptable Image Processing System) and `identify` commands for `@poe-platform/safe-bash`, powered by `@poe-code/image-ast`.

`sipsCommands()` registers only `sips`. Register `imagemagickCommands()` for the shell `identify` command; the direct `runIdentifyCli` and `createIdentifyCommand` APIs remain available.

## Commands

- `sips`: Query image properties (`-g`, including XML-escaped `allxml`), set/delete properties (`-s`/`-d`) across VFS reads and copies within the running process, resize (`-Z`, `-z`, `--resampleWidth`, `--resampleHeight`), crop (`-c`, `--cropOffset`), pad (`-p`, `--padColor`), rotate (`-r`), flip (`-f`), and convert formats (`-s format`, `-s formatOptions`, `--out`).
- `identify`: Inspect image format, geometry, bit depth, color space, and channel statistics (`identify [-ping] [-format ...] [-verbose] <file>...`).

The workspace entrypoint exports `sipsCommands()` for plugin registration,
`createSipsCommands()` for the command collection, and
`createSipsCommand()` for a single command. Each accepts an optional
`SipsCommandsOptions` object; existing factory names remain available.

Configure `limits: { maxInputBytes: 16 * 1024 * 1024 }` to bound command input. `SipsLimits` is exported for typed configuration; omitted limits default to `Infinity`. Long-running command loops and image resampling, cropping, rotation and flips yield to timers and cancellation, including Workers with frozen clocks.
