# Experiment loop asset copy follows a symlinked dist directory and writes outside the package

## Summary

The `@poe-code/experiment-loop` asset copy script writes default configuration assets into `dist/config` without rejecting symbolic links. A symlinked output directory redirects both copied assets to an external location.

## Reproduction

1. From the repository root, run this disposable package-fixture probe:

   ```sh
   probe=$(mktemp -d /tmp/poe-experiment-loop-copy-probe.XXXXXX)
   mkdir -p "$probe/pkg/src/config" "$probe/pkg/dist" "$probe/pkg/scripts" "$probe/outside"
   cp packages/experiment-loop/scripts/copy-assets.mjs "$probe/pkg/scripts/"
   printf 'escaped: true\n' > "$probe/pkg/src/config/default-run.yaml"
   printf 'ESCAPED INSTRUCTIONS\n' > "$probe/pkg/src/config/default-instructions.md"
   ln -s "$probe/outside" "$probe/pkg/dist/config"

   (cd "$probe/pkg" && node scripts/copy-assets.mjs)

   realpath "$probe/pkg/dist/config"
   cat "$probe/outside/default-run.yaml"
   cat "$probe/outside/default-instructions.md"
   ```

## Observed Behavior

The apparent `dist/config` output resolves to the external directory. Running the asset copy creates external `default-run.yaml` and `default-instructions.md` files containing the source assets.

`packages/experiment-loop/scripts/copy-assets.mjs:3` creates the fixed output directory and `packages/experiment-loop/scripts/copy-assets.mjs:4` through `packages/experiment-loop/scripts/copy-assets.mjs:5` copy assets through it without canonical-containment or symlink checks.

## Expected Behavior

Package asset copying should write only to canonical output paths under the package's `dist` directory. Symlinked `dist/config` output escaping the package should be rejected.

## Impact

A crafted package checkout or altered build tree can cause normal `@poe-code/experiment-loop` builds to write configuration assets outside the package with developer or CI privileges.
