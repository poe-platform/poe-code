# `safe-bash-command-sips`

Zero-dependency `sips` (macOS Scriptable Image Processing System) and `identify` commands for `@poe-platform/safe-bash`, powered by `@poe-code/image-ast`.

`sipsCommands()` registers only `sips`. Register `imagemagickCommands()` for the shell `identify` command; the direct `runIdentifyCli` and `createIdentifyCommand` APIs remain available.

## Commands

- `sips`: Query image properties (`-g`, including XML-escaped `allxml`), set/delete properties (`-s`/`-d`) in PNG/JPEG file metadata, preserved across VFS reads and copies, resize (`-Z`, `-z`, `--resampleWidth`, `--resampleHeight`), crop (`-c`, `--cropOffset`), pad (`-p`, `--padColor`), rotate (`-r`), flip (`-f`), and convert formats (`-s format`, `-s formatOptions`, `--out`).
- `identify`: Inspect image format, geometry, bit depth, color space, and channel statistics (`identify [-ping] [-format ...] [-verbose] <file>...`).

`runIdentifyCli(argv, { filesystem, cwd }, signal)` inspects files through the caller's
filesystem. PNG, JPEG, WebP, TIFF, GIF, BMP and Netpbm metadata and statistics use
retained reads and bounded caller-backed storage. The byte-map signature remains
available for callers that already hold complete inputs.

`runSipsCli(argv, { filesystem, cwd }, signal)` uses the same file authority as the
command. Property queries and verification retain raster sources; PNG/JPEG custom
properties are scanned in bounded ranges without reading unrelated pixel payloads.
Mutations currently use the byte-oriented processing engine and publish through the
supplied filesystem. The byte-map and synchronous convenience APIs remain available.

The workspace entrypoint exports `sipsCommands()` for plugin registration,
`createSipsCommands()` for the command collection, and
`createSipsCommand()` for a single command. Each accepts an optional
`SipsCommandsOptions` object; existing factory names remain available.

Configure `limits: { maxInputBytes: 16 * 1024 * 1024 }` to bound command input. The shell input budget also applies cumulatively across image files. `SipsLimits` is exported for typed configuration; omitted limits default to `Infinity`. Long-running command loops and image resampling, cropping, rotation and flips yield to timers and cancellation, including Workers with frozen clocks.

Custom properties use namespaced PNG iTXt or JPEG comment metadata, limited to 65,500 UTF-8 payload bytes per image. Other output formats reject custom property persistence explicitly. Output parent directories must already exist; `--out` does not create them. File output, including metadata, uses the shell output budget.
