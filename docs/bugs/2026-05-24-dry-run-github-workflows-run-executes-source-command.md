# Dry-run github-workflows run executes source command

## Summary

Running a sourced GitHub automation with the root `--dry-run` option still executes its configured source command before determining whether any agent work is needed.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a fake `gh` executable on `PATH`

## Reproduction

From the repository root, create a disposable project and a fake `gh` executable that records source lookups and returns no Dependabot alerts:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project" "$probe/bin"
cat > "$probe/bin/gh" <<'SH'
#!/bin/sh
printf 'executed:%s\n' "$*" >> "$FAKE_MARKER"
printf '[]\n'
exit 0
SH
chmod +x "$probe/bin/gh"

(
  cd "$probe/project"
  PATH="$probe/bin:$PATH" FAKE_MARKER="$probe/gh-marker" HOME="$probe/home" \
    POE_API_KEY=probe GITHUB_TOKEN=token GITHUB_REPOSITORY=acme/repo \
    /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run \
    github-workflows run fix-vulnerabilities --agent claude-code
)

cat "$probe/gh-marker"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command exits successfully and reports running `fix-vulnerabilities` for `0` items.
- The fake `gh` executable records `gh api repos/acme/repo/dependabot/alerts --jq ...` despite root `--dry-run`.
- Returning no source items keeps the reproduction bounded and proves source execution without invoking an agent.

## Expected Behavior

With root `--dry-run`, a sourced workflow automation must not execute external source commands. It should preview the source query and any resulting agent dispatch plan without running either.

## Impact

- A preview can query GitHub or execute any configured source shell command unexpectedly.
- Source commands may expose credentials, access network resources, or incur side effects before agent execution begins.
- Users cannot safely inspect sourced automation selection behavior before running it.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`, but forwarded Toolcraft flags do not include `--dry-run`. `packages/github-workflows/src/commands.ts` implements sourced automation runs by invoking `runCommand("sh", ["-c", resolveSourceCommand(...)])` before dispatching any items.

## Suspected Area

Forwarded workflow run commands need root dry-run propagation and a preview-only path before executing configured source commands.
