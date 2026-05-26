# Root bundler follows a symlinked skill template directory and writes outside the repository

## Summary

The root `scripts/bundle.mjs` build copies packaged skill templates into `dist/templates/skill` without rejecting symbolic links. A symlinked template output directory redirects bundled documentation assets outside the repository.

## Reproduction

1. From the repository root, run this disposable clean-copy probe. Existing generated package artifacts are copied only to satisfy internal source imports during bundling:

   ```sh
   probe=$(mktemp -d /tmp/poe-root-bundle-skill-template-probe.XXXXXX)
   git archive --format=tar HEAD | tar -xf - -C "$probe"
   ln -s "$PWD/node_modules" "$probe/node_modules"
   for src in packages/*/dist; do
     [ -d "$src" ] || continue
     pkg=${src%/dist}; pkg=${pkg#packages/}
     mkdir -p "$probe/packages/$pkg"
     cp -R "$src" "$probe/packages/$pkg/"
   done
   mkdir -p "$probe/dist/templates" "$probe/outside"
   ln -s "$probe/outside" "$probe/dist/templates/skill"

   (cd "$probe" && node scripts/bundle.mjs)

   realpath "$probe/dist/templates/skill"
   find "$probe/outside" -maxdepth 1 -type f -print | sort
   ```

## Observed Behavior

The apparent root package output `dist/templates/skill` resolves externally, and the build creates external `poe-generate.md` and `terminal-pilot.md` files containing copied package assets.

`scripts/bundle.mjs:211` through `scripts/bundle.mjs:218` prepare fixed template output paths, while `scripts/bundle.mjs:233` through `scripts/bundle.mjs:239` copy skill templates through that directory without canonical-containment or symlink checks.

## Expected Behavior

Root builds should copy packaged templates only into canonical locations beneath the repository `dist` directory. A symlinked template directory escaping the repository should be rejected.

## Impact

A crafted checkout or modified build output can make standard root bundle generation write packaged Markdown assets outside the repository with developer or CI privileges.
