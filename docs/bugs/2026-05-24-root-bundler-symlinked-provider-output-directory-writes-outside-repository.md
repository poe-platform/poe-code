# Root bundler follows a symlinked provider output directory and writes outside the repository

## Summary

The root `scripts/bundle.mjs` build sends provider bundle output into `dist/providers` without rejecting symbolic links. A symlinked provider output directory redirects generated provider JavaScript and source-map files outside the repository.

## Reproduction

1. From the repository root, run this disposable clean-copy probe. Existing generated package artifacts are copied only to satisfy internal source imports during bundling:

   ```sh
   probe=$(mktemp -d /tmp/poe-root-bundle-provider-probe.XXXXXX)
   git archive --format=tar HEAD | tar -xf - -C "$probe"
   ln -s "$PWD/node_modules" "$probe/node_modules"
   for src in packages/*/dist; do
     [ -d "$src" ] || continue
     pkg=${src%/dist}; pkg=${pkg#packages/}
     mkdir -p "$probe/packages/$pkg"
     cp -R "$src" "$probe/packages/$pkg/"
   done
   mkdir -p "$probe/dist" "$probe/outside"
   ln -s "$probe/outside" "$probe/dist/providers"

   (cd "$probe" && node scripts/bundle.mjs)

   realpath "$probe/dist/providers"
   find "$probe/outside" -maxdepth 1 -type f -print | sort
   ```

## Observed Behavior

The apparent root build output directory `dist/providers` resolves externally, and ordinary bundling creates provider bundle files and source maps such as `codex.js` and `codex.js.map` in the external directory.

`scripts/bundle.mjs:116` through `scripts/bundle.mjs:132` enumerate provider entries and pass the fixed `dist/providers` directory to `esbuild` without canonical-containment or symlink checks.

## Expected Behavior

Root builds should emit generated provider artifacts only within the repository's canonical `dist` tree. A provider output directory that resolves through a symlink outside the repository should be rejected.

## Impact

A crafted checkout or stale build-tree symlink can cause routine root package builds to create or overwrite multiple external generated provider artifacts with developer or CI privileges.
