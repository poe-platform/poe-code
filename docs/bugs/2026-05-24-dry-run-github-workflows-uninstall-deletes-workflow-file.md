# Dry-run github-workflows uninstall deletes workflow file

## Summary

Running `github-workflows uninstall` with the root `--dry-run` option still deletes the selected workflow file from the project.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable installed workflow and preview its removal:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/.github/workflows"
printf 'sentinel\n' > "$probe/project/.github/workflows/poe-code-fix-vulnerabilities.yml"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run github-workflows uninstall fix-vulnerabilities
)

test -f "$probe/project/.github/workflows/poe-code-fix-vulnerabilities.yml" \
  && cat "$probe/project/.github/workflows/poe-code-fix-vulnerabilities.yml" \
  || printf 'file deleted\n'
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command exits successfully and reports `Removed workflow .../.github/workflows/poe-code-fix-vulnerabilities.yml`.
- The pre-existing workflow file is deleted from the disposable project.

## Expected Behavior

With root `--dry-run`, workflow removal must not unlink an installed workflow file. It should report the file that would be removed while preserving it on disk.

## Impact

- A preview operation irreversibly removes project CI configuration.
- Users cannot safely inspect uninstall effects before accepting them.
- Automation that uses dry-run safeguards can accidentally disable a workflow.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `github-workflows` is registered as a forwarded Toolcraft command, while `packages/github-workflows/src/commands.ts` implements uninstall by calling `unlink` without handling a root dry-run flag.

## Suspected Area

Forwarded GitHub workflow commands need dry-run flag propagation and non-mutating uninstall previews.
