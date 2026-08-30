# Source admission

A workspace package can opt out specific held source paths in its own
`package.json`, alongside other `poeCode` metadata:

```json
{
  "poeCode": {
    "packageLint": {
      "sourceExclude": ["src/experimental", "src/held-entry.ts"]
    }
  }
}
```

`poeCode.packageLint`, when present, must be an object containing exactly one
property, `sourceExclude`, whose value is an array of unique strings. An empty
array excludes nothing. Omitting `packageLint` preserves normal source analysis.

Each entry is a literal, package-relative POSIX file or directory path strictly
below `src`. Directory entries exclude their descendants; file entries match
exactly. Prefix neighbors such as `src/experimental-neighbor.ts` remain admitted.
Entries must not contain empty, `.` or `..` path segments, leading or trailing
segment whitespace, control characters, backslashes, colons, or glob/extglob
characters (`*`, `?`, `[`, `]`, `{`, `}`, `!`, `(`, `)`). Absolute paths, trailing
slashes, duplicate entries, and excluding `src` itself are rejected. Paths do not
need to exist.

Invalid configuration fails workspace loading before source-content reads,
including when the CLI selects only particular rules. Source imports and runtime
file-asset inference share the same admission filter, applied before `readFile`.
The recursive adapter also prunes excluded directories; a bulk `listFiles`
adapter may enumerate excluded names but their contents are never read by these
scanners. Other packages are unaffected. Root `main`, export, and bin targets
receive the owning package's admission checks before import analysis. A target
that names excluded source produces an explicit tool error rather than silently
dropping the packaging entry or reading its contents.

Both scanners continue to analyze TypeScript source (`.ts`, `.tsx`, `.mts`,
`.cts`) under `src`, excluding declaration files. Dependency and tool-metadata
directories named `node_modules`, `.git`, or `.turbo` are not treated as
package-owned source. A name such as `src/dist` does not prove generated ownership:
its source remains analyzed unless explicitly excluded. Packaging inventories
remain separate; source exclusions are not packaging exclusions.

On a stable checkout, the analyzer checks filesystem metadata for every path
component before reading source or root entrypoints, requires real directories
and regular files, and checks canonical package ownership. Symbolic links
(including source roots), special files such as FIFOs, missing metadata
capabilities, and inconsistent ownership are explicit errors. Exclusions match
literal and canonical paths plus device/inode identities of explicitly excluded
paths, without case-folding distinct files on case-sensitive filesystems.

Metadata is cached and content is subsequently read by pathname; these checks
are not a TOCTOU-resistant security boundary. A directory exclusion does not
inventory the identities of all descendant files, so it does not cover hardlinks
outside that directory to every excluded descendant. Case-insensitive alias
controls use synthetic fixtures; native Windows behavior has not been verified.

SDK callers supplying packages directly to `scanSourceImports` or
`scanRuntimeFileAssets` may set the same optional `sourceExclude` array on each
package descriptor. The scanners validate all descriptors before reading source.
`loadWorkspace` derives these descriptors from package manifests automatically.
`scanImportFiles` accepts an optional fourth argument containing package
descriptors to apply owning-package exclusions to root entrypoints.

Source-scanning `LintFs` adapters must supply `lstat` and `realpath`; `lstat`
returns device/inode identity and `isDirectory`, `isFile`, and `isSymbolicLink`
predicates. These methods remain optional for packaging-only adapters, but source
analysis fails closed when they are absent. The CLI uses the shared metadata-aware
recursive collector rather than treating every non-directory entry as a file.
