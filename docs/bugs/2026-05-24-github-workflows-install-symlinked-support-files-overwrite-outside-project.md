# GitHub workflows install follows symlinked support files and overwrites outside the project

## Summary

Every `github-workflows install` operation writes shared support documents `variables.yaml` and `README.md` beneath `.github/workflows` without rejecting symbolic links at either destination. Symlinked support entries redirect project setup output to external files.

## Reproduction

1. From the repository root, run this disposable project probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-gh-support-probe.XXXXXX)
   mkdir -p "$probe/project/.github/workflows" "$probe/outside"
   printf '# Existing variables\nCUSTOM_VALUE: preserved\n' > "$probe/outside/variables.yaml"
   printf 'ORIGINAL README\n' > "$probe/outside/README.md"
   ln -s "$probe/outside/variables.yaml" "$probe/project/.github/workflows/variables.yaml"
   ln -s "$probe/outside/README.md" "$probe/project/.github/workflows/README.md"

   (cd "$probe/project" && \
     "$workspace/node_modules/.bin/tsx" --import "$workspace/scripts/register-template-loader.mjs" \
     "$workspace/src/index.ts" --yes github-workflows install fix-vulnerabilities)

   realpath "$probe/project/.github/workflows/variables.yaml"
   realpath "$probe/project/.github/workflows/README.md"
   head -n 5 "$probe/outside/variables.yaml"
   head -n 4 "$probe/outside/README.md"
   ```

## Observed Behavior

The CLI reports project-local shared variable and command-reference paths, but both symlink targets outside the project are overwritten with generated workflow support content.

`packages/github-workflows/src/commands.ts:231` through `packages/github-workflows/src/commands.ts:239` invoke support-file setup during installation. `packages/github-workflows/src/commands.ts:802` through `packages/github-workflows/src/commands.ts:820` read and write `variables.yaml` and write `README.md` without rejecting symlinked files or validating their canonical location.

## Expected Behavior

Workflow installation support files should be written only to canonical `.github/workflows` files within the current project. Symlinked support destinations escaping the project should be rejected.

## Impact

A crafted repository can cause ordinary workflow installation to overwrite external YAML and Markdown documents with generated setup content, creating multiple out-of-project writes in a single command.
