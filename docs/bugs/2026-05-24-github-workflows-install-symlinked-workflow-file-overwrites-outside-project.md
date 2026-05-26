# GitHub workflows install follows a symlinked workflow file and overwrites outside the project

## Summary

The `github-workflows install` command writes its selected installed workflow beneath `.github/workflows` without rejecting symbolic links at the destination file. A symlinked workflow entry redirects normal installation output outside the project.

## Reproduction

1. From the repository root, run this disposable project probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-gh-install-probe.XXXXXX)
   mkdir -p "$probe/project/.github/workflows" "$probe/outside"
   printf 'ORIGINAL WORKFLOW\n' > "$probe/outside/workflow.yml"
   ln -s "$probe/outside/workflow.yml" \
     "$probe/project/.github/workflows/poe-code-fix-vulnerabilities.yml"

   (cd "$probe/project" && \
     "$workspace/node_modules/.bin/tsx" --import "$workspace/scripts/register-template-loader.mjs" \
     "$workspace/src/index.ts" --yes github-workflows install fix-vulnerabilities)

   realpath "$probe/project/.github/workflows/poe-code-fix-vulnerabilities.yml"
   head -n 4 "$probe/outside/workflow.yml"
   ```

## Observed Behavior

The command reports the project-local workflow path as installed, but the destination resolves externally and `outside/workflow.yml` is overwritten with the generated `Fix Vulnerabilities` workflow.

`packages/github-workflows/src/commands.ts:208` through `packages/github-workflows/src/commands.ts:264` implement the installation command. `packages/github-workflows/src/commands.ts:771` through `packages/github-workflows/src/commands.ts:797` derive and write the workflow file without rejecting symlinked destinations or validating canonical project containment.

## Expected Behavior

Installed workflow files should be written only to canonical `.github/workflows` entries within the current project. A symlinked workflow output escaping the project should be rejected before installation.

## Impact

A crafted repository can make routine workflow installation overwrite an external YAML file with generated CI configuration while the CLI output identifies only the apparent project-local destination.
