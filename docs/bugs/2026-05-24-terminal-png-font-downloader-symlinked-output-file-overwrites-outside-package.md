# Terminal PNG font downloader follows a symlinked output file and overwrites outside the package

## Summary

The `@poe-code/terminal-png` font download script writes the fetched JetBrains Mono asset to a fixed package file without rejecting symbolic links. A symlinked font destination redirects the downloaded binary outside the package.

## Reproduction

1. From the repository root, run this disposable package-fixture probe. It performs the same upstream font download as the script itself:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-terminal-font-probe.XXXXXX)
   mkdir -p "$probe/repo/packages/terminal-png/scripts" "$probe/repo/packages/terminal-png/assets"
   printf '{"type":"module"}\n' > "$probe/repo/package.json"
   cp packages/terminal-png/scripts/download-font.ts "$probe/repo/packages/terminal-png/scripts/"
   printf 'ORIGINAL\n' > "$probe/outside.ttf"
   ln -s "$probe/outside.ttf" \
     "$probe/repo/packages/terminal-png/assets/jetbrains-mono-400-normal.ttf"

   (cd "$probe/repo" && \
     "$workspace/node_modules/.bin/tsx" packages/terminal-png/scripts/download-font.ts)

   realpath "$probe/repo/packages/terminal-png/assets/jetbrains-mono-400-normal.ttf"
   wc -c "$probe/outside.ttf"
   ```

## Observed Behavior

The apparent font asset output resolves to the external target, and invoking the downloader overwrites that external file with the downloaded font bytes. In the probe, the external file becomes a 273900-byte TTF asset.

`packages/terminal-png/scripts/download-font.ts:18` through `packages/terminal-png/scripts/download-font.ts:21` define the fixed asset output path, while `packages/terminal-png/scripts/download-font.ts:28` through `packages/terminal-png/scripts/download-font.ts:30` write downloaded bytes through it without canonical-containment or symlink checks.

## Expected Behavior

Downloaded package assets should be written only to canonical locations under the package asset directory. A destination path resolving through a symlink outside the package should be rejected.

## Impact

A crafted checkout or replaced font-output entry can cause the font refresh command to overwrite an arbitrary external file with binary font data using developer or CI privileges.
