# Root bundler follows a symlinked dist directory and writes outside the repository

## Summary

The root `scripts/bundle.mjs` build writes its main executable bundles and copied runtime assets beneath the fixed repository `dist` directory without rejecting symbolic links. A symlinked `dist` output redirects the root package build outside the repository.

## Reproduction

1. From the repository root, run this disposable clean-copy probe. Existing generated package artifacts are copied only to satisfy internal source imports during bundling:

   ```sh
   probe=$(mktemp -d /tmp/poe-root-dist-probe.XXXXXX)
   git archive --format=tar HEAD | tar -xf - -C "$probe"
   ln -s "$PWD/node_modules" "$probe/node_modules"
   for src in packages/*/dist; do
     [ -d "$src" ] || continue
     pkg=${src%/dist}; pkg=${pkg#packages/}
     mkdir -p "$probe/packages/$pkg"
     cp -R "$src" "$probe/packages/$pkg/"
   done
   rm -rf "$probe/dist"
   mkdir -p "$probe/outside"
   ln -s "$probe/outside" "$probe/dist"

   (cd "$probe" && node scripts/bundle.mjs)

   realpath "$probe/dist"
   find "$probe/outside" -maxdepth 2 -print | sort | head -30
   ```

## Observed Behavior

The apparent root package output directory `dist` resolves externally. Running the bundler creates or overwrites external root files including `index.js`, `index.js.map`, `bin.cjs`, and `SYSTEM_PROMPT.md`, along with external output subdirectories such as `providers`, `templates`, `corpus`, `prompts`, and `workflow-templates`.

`scripts/bundle.mjs:100` through `scripts/bundle.mjs:114` emit the main bundle to `dist/index.js`; `scripts/bundle.mjs:202` through `scripts/bundle.mjs:209` write `dist/bin.cjs`; and `scripts/bundle.mjs:211` through `scripts/bundle.mjs:257` create and populate multiple static-asset destinations under the same unchecked output directory.

## Expected Behavior

The root package build should emit artifacts only into the canonical repository build directory. A symlinked root `dist` output that resolves outside the repository should be rejected before any build output is written.

## Impact

A crafted checkout or pre-existing root build symlink can make a standard package build create or overwrite a broad set of external executable and asset files with developer or CI privileges.
