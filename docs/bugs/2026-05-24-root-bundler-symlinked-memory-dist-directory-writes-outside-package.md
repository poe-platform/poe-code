# Root bundler follows a symlinked memory dist directory and writes outside the package

## Summary

The root `scripts/bundle.mjs` build emits the bundled `@poe-code/memory` entry point and copied token corpus beneath `packages/memory/dist` without rejecting symbolic links. A symlinked memory output directory redirects package build artifacts outside the repository.

## Reproduction

1. From the repository root, run this disposable clean-copy probe. Existing generated package artifacts are copied only to satisfy internal source imports during bundling:

   ```sh
   probe=$(mktemp -d /tmp/poe-root-memory-dist-probe.XXXXXX)
   git archive --format=tar HEAD | tar -xf - -C "$probe"
   ln -s "$PWD/node_modules" "$probe/node_modules"
   for src in packages/*/dist; do
     [ -d "$src" ] || continue
     pkg=${src%/dist}; pkg=${pkg#packages/}
     mkdir -p "$probe/packages/$pkg"
     cp -R "$src" "$probe/packages/$pkg/"
   done
   mv "$probe/packages/memory/dist" "$probe/outside-memory"
   printf 'EXTERNAL BEFORE\n' > "$probe/outside-memory/index.js"
   ln -s "$probe/outside-memory" "$probe/packages/memory/dist"

   (cd "$probe" && node scripts/bundle.mjs)

   realpath "$probe/packages/memory/dist"
   head -c 40 "$probe/outside-memory/index.js"
   find "$probe/outside-memory/corpus" -type f | head
   ```

## Observed Behavior

The apparent `packages/memory/dist` package output resolves to the external directory. Root bundling overwrites the external `index.js` with generated memory-bundle JavaScript and copies the token corpus beneath the external `corpus` descendant.

`scripts/bundle.mjs:137` through `scripts/bundle.mjs:148` pass `packages/memory/dist/index.js` to `esbuild`, while `scripts/bundle.mjs:191` through `scripts/bundle.mjs:197` copy runtime corpus assets beneath the same unchecked output tree.

## Expected Behavior

Root builds should emit `@poe-code/memory` artifacts only beneath the canonical package build tree. A symlinked package `dist` directory escaping the repository should be rejected.

## Impact

A crafted checkout or stale package-output symlink can cause normal root builds to overwrite external JavaScript and copy runtime corpus data outside the repository with developer or CI privileges.
