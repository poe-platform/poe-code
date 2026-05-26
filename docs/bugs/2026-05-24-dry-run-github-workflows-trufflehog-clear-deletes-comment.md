# Dry-run github-workflows trufflehog clear deletes comment

## Summary

Running `github-workflows trufflehog-pr-scan clear-stale-advisory-result` with the root `--dry-run` option still dispatches a GitHub API request to delete an existing advisory pull-request comment.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a fake `gh` executable on `PATH`

## Reproduction

From the repository root, create a disposable project and a fake `gh` executable that returns an existing TruffleHog comment and records follow-up API calls:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project" "$probe/bin"
cat > "$probe/bin/gh" <<'SH'
#!/bin/sh
printf 'command:' >> "$FAKE_MARKER"
printf ' <%s>' "$@" >> "$FAKE_MARKER"
printf '\n' >> "$FAKE_MARKER"
case "$*" in
  *'repos/acme/repo/issues/17/comments'*)
    printf '[{"id":808,"body":"<!-- trufflehog-pr-scan --> old result"}]\n'
    ;;
  *) printf '{}\n' ;;
esac
exit 0
SH
chmod +x "$probe/bin/gh"

(
  cd "$probe/project"
  PATH="$probe/bin:$PATH" FAKE_MARKER="$probe/gh-marker" HOME="$probe/home" \
    GH_TOKEN=token PR_NUMBER=17 REPOSITORY=acme/repo \
    /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run \
    github-workflows trufflehog-pr-scan clear-stale-advisory-result
)

cat "$probe/gh-marker"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command exits successfully and prints `Done.`.
- The fake `gh` executable records a comment lookup followed by `gh api repos/acme/repo/issues/comments/808 --method DELETE`.

## Expected Behavior

With root `--dry-run`, stale advisory cleanup must not delete GitHub comments. It should only report which existing comment would be removed.

## Impact

- A preview can remove an existing security advisory comment from a pull request.
- Repository participants may lose visible scan history without an explicit mutating invocation.
- Workflow maintainers cannot safely validate cleanup routing before applying destructive API calls.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`, but forwarded Toolcraft flags do not include `--dry-run`. `packages/github-workflows/src/exec/trufflehog-pr-scan.ts` unconditionally calls `gh api ... --method DELETE` after locating an existing advisory comment in `clearStaleAdvisoryResult`.

## Suspected Area

Forwarded workflow helper commands need root dry-run propagation and preview-only guards for destructive GitHub API operations.
