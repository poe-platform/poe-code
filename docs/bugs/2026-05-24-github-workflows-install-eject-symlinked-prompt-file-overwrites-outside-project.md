# GitHub workflows install eject follows a symlinked prompt file and overwrites outside the project

## Summary

When `github-workflows install --eject` copies an editable automation prompt into `.github/workflows`, it does not reject a symbolic link at the generated Markdown destination. A symlinked ejected prompt entry redirects copied prompt instructions outside the project.

## Reproduction

1. From the repository root, run this disposable project probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-gh-eject-probe.XXXXXX)
   mkdir -p "$probe/project/.github/workflows" "$probe/outside"
   printf 'ORIGINAL PROMPT\n' > "$probe/outside/prompt.md"
   ln -s "$probe/outside/prompt.md" \
     "$probe/project/.github/workflows/poe-code-fix-vulnerabilities.md"

   (cd "$probe/project" && \
     "$workspace/node_modules/.bin/tsx" --import "$workspace/scripts/register-template-loader.mjs" \
     "$workspace/src/index.ts" --yes github-workflows install fix-vulnerabilities --eject)

   realpath "$probe/project/.github/workflows/poe-code-fix-vulnerabilities.md"
   head -n 5 "$probe/outside/prompt.md"
   ```

## Observed Behavior

The command reports `Prompt copied to` the project-facing Markdown path, while the external target is overwritten with the generated prompt header and automation prompt content.

`packages/github-workflows/src/commands.ts:771` through `packages/github-workflows/src/commands.ts:797` compute the optional ejected `promptPath`, create its apparent parent directory, and write through it without canonical-containment or symbolic-link checks.

## Expected Behavior

Ejected workflow prompt files should be copied only into canonical project workflow storage. A prompt output file resolving outside the project should be rejected rather than overwritten.

## Impact

A crafted repository can redirect installation of editable automation instructions into an unrelated external Markdown file, overwriting user content while appearing to customize only local workflow state.
