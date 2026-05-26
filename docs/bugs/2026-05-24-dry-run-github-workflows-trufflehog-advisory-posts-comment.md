# Dry-run github-workflows trufflehog advisory posts comment

## Summary

Running `github-workflows trufflehog-pr-scan report-advisory-result` with the root `--dry-run` option still dispatches a GitHub API request to create an advisory pull-request comment and writes the workflow step summary.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a fake `gh` executable on `PATH`

## Reproduction

From the repository root, create a disposable project, an isolated finding file, and a fake `gh` executable that records API calls:

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
    if printf '%s\n' "$*" | grep -q -- '--method POST'; then printf '{}\n'; else printf '[]\n'; fi
    ;;
  *) printf '{}\n' ;;
esac
exit 0
SH
chmod +x "$probe/bin/gh"
printf '%s\n' '{"DetectorName":"Probe","Verified":false,"SourceMetadata":{"Data":{"Git":{"file":"secret.txt","line":3}}}}' > "$probe/results.jsonl"

(
  cd "$probe/project"
  PATH="$probe/bin:$PATH" FAKE_MARKER="$probe/gh-marker" HOME="$probe/home" \
    GH_TOKEN=token HEAD_SHA=head MAX_FINDINGS=5 PR_NUMBER=17 REPOSITORY=acme/repo \
    TRUFFLEHOG_RESULTS_FILE="$probe/results.jsonl" GITHUB_STEP_SUMMARY="$probe/summary.md" \
    /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run \
    github-workflows trufflehog-pr-scan report-advisory-result
)

cat "$probe/gh-marker" "$probe/summary.md"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command exits successfully and prints workflow error annotations followed by `Done.`.
- The fake `gh` executable records a lookup call and a second `gh api ... --method POST --field body=...` call that would create the pull-request advisory comment.
- The command writes the advisory Markdown content to `GITHUB_STEP_SUMMARY`.

## Expected Behavior

With root `--dry-run`, reporting a finding must not create or update GitHub comments or write workflow summary files. It should preview the advisory operation only.

## Impact

- A preview can post visible pull-request comments and notify repository participants.
- Dry-run can mutate GitHub Actions job output surfaces and falsely report findings during evaluation.
- Workflow maintainers cannot safely inspect advisory behavior before performing repository-visible operations.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`, but forwarded Toolcraft flags do not include `--dry-run`. `packages/github-workflows/src/exec/trufflehog-pr-scan.ts` unconditionally uses `gh api` to create or patch comments and appends `GITHUB_STEP_SUMMARY` in `reportAdvisoryResult`.

## Suspected Area

Forwarded workflow helper commands need root dry-run propagation and preview-only guards for GitHub API mutations and Actions summary writes.
