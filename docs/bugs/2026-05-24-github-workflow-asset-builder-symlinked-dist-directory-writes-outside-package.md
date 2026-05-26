# GitHub workflow asset builder follows a symlinked dist directory and writes outside the package

## Summary

The `@poe-code/github-workflows` asset build script copies packaged prompt and workflow-template assets into `dist` subdirectories without rejecting symbolic links. A symlinked `dist/prompts` directory redirects routine package build output to an external location.

## Reproduction

1. From the repository root, run this disposable package-fixture probe:

   ```sh
   probe=$(mktemp -d /tmp/poe-gh-assets-probe.XXXXXX)
   mkdir -p "$probe/repo/packages/github-workflows/scripts" \
     "$probe/repo/packages/github-workflows/src/prompts" \
     "$probe/repo/packages/github-workflows/src/workflow-templates" \
     "$probe/repo/packages/github-workflows/dist" \
     "$probe/repo/scripts" "$probe/outside"
   printf '{"type":"module"}\n' > "$probe/repo/package.json"
   cp packages/github-workflows/scripts/build-assets.ts \
     "$probe/repo/packages/github-workflows/scripts/"
   cp scripts/bundle-assets.mjs "$probe/repo/scripts/"
   printf 'PROMPT CONTENT\n' > "$probe/repo/packages/github-workflows/src/prompts/probe.md"
   printf 'TEMPLATE CONTENT\n' > "$probe/repo/packages/github-workflows/src/workflow-templates/probe.yml"
   printf 'EXTERNAL ORIGINAL\n' > "$probe/outside/probe.md"
   ln -s "$probe/outside" "$probe/repo/packages/github-workflows/dist/prompts"

   "$PWD/node_modules/.bin/tsx" \
     "$probe/repo/packages/github-workflows/scripts/build-assets.ts"

   realpath "$probe/repo/packages/github-workflows/dist/prompts"
   cat "$probe/outside/probe.md"
   ```

## Observed Behavior

The apparent package output directory `dist/prompts` resolves to the external target, and the external `probe.md` file is overwritten with `PROMPT CONTENT` during the build-assets invocation. The non-symlinked workflow-template output is written normally inside the fixture package.

`resolveGithubWorkflowPackageAssetCopies()` defines `dist/prompts` as an asset target in `scripts/bundle-assets.mjs:3`. `packages/github-workflows/scripts/build-assets.ts` creates each target and then uses `copyFile()` into it without canonical-containment or symlink checks.

## Expected Behavior

Package asset builds should copy files only into canonical directories within the package build output. A symlinked `dist` descendant escaping the package should be rejected rather than used as a copy destination.

## Impact

A crafted package workspace or pre-existing build-tree symlink can cause ordinary GitHub-workflows package builds to overwrite external files with developer or CI privileges. The trigger is part of the package's documented build script and can operate on multiple bundled prompt files.
