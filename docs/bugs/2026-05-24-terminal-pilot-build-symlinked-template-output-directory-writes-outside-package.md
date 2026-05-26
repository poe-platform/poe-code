# Terminal Pilot build follows a symlinked template output directory and writes outside the package

## Summary

The `@poe-code/terminal-pilot` package build copies its bundled skill template into `dist/templates` without rejecting symbolic links. A symlinked template output directory redirects normal published-package assets outside the package.

## Reproduction

1. From the repository root, run this disposable clean-copy probe. Existing generated package artifacts are copied only to satisfy internal source imports during bundling:

   ```sh
   probe=$(mktemp -d /tmp/poe-terminal-pilot-build-probe.XXXXXX)
   git archive --format=tar HEAD | tar -xf - -C "$probe"
   ln -s "$PWD/node_modules" "$probe/node_modules"
   for src in packages/*/dist; do
     [ -d "$src" ] || continue
     pkg=${src%/dist}; pkg=${pkg#packages/}
     mkdir -p "$probe/packages/$pkg"
     cp -R "$src" "$probe/packages/$pkg/"
   done
   mkdir -p "$probe/outside" "$probe/packages/terminal-pilot/dist"
   rm -rf "$probe/packages/terminal-pilot/dist/templates"
   ln -s "$probe/outside" "$probe/packages/terminal-pilot/dist/templates"

   (cd "$probe" && node packages/terminal-pilot/scripts/build.mjs)

   realpath "$probe/packages/terminal-pilot/dist/templates"
   head -n 3 "$probe/outside/terminal-pilot.md"
   ```

## Observed Behavior

The apparent package template output resolves to the external directory, and normal `terminal-pilot` build execution writes `terminal-pilot.md` into that external location.

`packages/terminal-pilot/scripts/build.mjs:9` defines the fixed package output tree, and `packages/terminal-pilot/scripts/build.mjs:105` through `packages/terminal-pilot/scripts/build.mjs:109` create and copy through `dist/templates` without canonical-containment or symlink checks.

## Expected Behavior

The package build should emit copied templates only beneath the canonical package `dist` directory. A symlinked template output directory escaping the package should be rejected.

## Impact

A crafted checkout or pre-existing build-output symlink can make routine `@poe-code/terminal-pilot` builds write published assets outside the package with developer or CI privileges.
