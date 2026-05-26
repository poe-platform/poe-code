# Dry-run github-workflows install writes workflow files

## Summary

Running `github-workflows install` with the root `--dry-run` option still installs workflow support files in the project.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, preview installation of one built-in workflow in a clean disposable project:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run github-workflows install fix-vulnerabilities
)

find "$probe/project" -maxdepth 7 -print
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command exits successfully and reports `Installed workflow at .../.github/workflows/poe-code-fix-vulnerabilities.yml`.
- The command creates `.github/workflows/poe-code-fix-vulnerabilities.yml`.
- The command also creates `.github/workflows/variables.yaml` and `.github/workflows/README.md`.

## Expected Behavior

With root `--dry-run`, workflow installation must not create workflow or support files. It should only render the intended installation actions.

## Impact

- Previewing workflow setup changes the repository's GitHub Actions configuration.
- Root dry-run cannot be used as a safety barrier before introducing CI files.
- Scripts that evaluate installation output can unexpectedly create tracked workflow artifacts.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `github-workflows` is registered through the forwarded Toolcraft command mechanism, while `packages/github-workflows/src/commands.ts` installs automations and writes shared support files without handling a root dry-run flag.

## Suspected Area

Forwarded GitHub workflow commands need dry-run propagation and write-aware preview behavior.
