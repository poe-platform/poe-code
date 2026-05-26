# Dry-run github-workflows trufflehog scan executes Docker and writes results

## Summary

Running `github-workflows trufflehog-pr-scan scan-for-secrets` with the root `--dry-run` option still executes the configured Docker scan and writes scan result artifacts.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a fake `docker` executable on `PATH`

## Reproduction

From the repository root, create a disposable project and a fake `docker` executable that records execution and returns one JSONL finding:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project" "$probe/bin"
cat > "$probe/bin/docker" <<'SH'
#!/bin/sh
printf 'executed:%s\n' "$*" >> "$FAKE_MARKER"
printf '%s\n' '{"DetectorName":"Probe","Verified":false,"SourceMetadata":{"Data":{"Git":{"file":"probe.txt","line":1}}}}'
printf 'fake stderr\n' >&2
exit 183
SH
chmod +x "$probe/bin/docker"

(
  cd "$probe/project"
  PATH="$probe/bin:$PATH" FAKE_MARKER="$probe/docker-marker" HOME="$probe/home" \
    BASE_SHA=base HEAD_SHA=head RESULTS=verified TRUFFLEHOG_IMAGE=fake/image \
    TRUFFLEHOG_RESULTS_FILE="$probe/results.jsonl" \
    TRUFFLEHOG_STDERR_FILE="$probe/stderr.log" GITHUB_OUTPUT="$probe/github-output" \
    /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run \
    github-workflows trufflehog-pr-scan scan-for-secrets
)

cat "$probe/docker-marker" "$probe/results.jsonl" "$probe/stderr.log" "$probe/github-output"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command exits successfully and prints `Done.` even though `--dry-run` was supplied.
- The fake `docker` executable is invoked with the TruffleHog scan command.
- The command writes `results.jsonl`, `stderr.log`, and `github-output`, including `exit_code=183` and `findings_count=1`.

## Expected Behavior

With root `--dry-run`, secret scanning must not launch Docker or write result, stderr, or GitHub Actions output files. It should only preview the scan it would execute.

## Impact

- A preview can start container workloads and scan repository contents unexpectedly.
- Dry-run may overwrite workflow artifact paths and mutate GitHub Actions output state.
- Users cannot safely inspect the workflow helper before running potentially expensive or sensitive scans.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`, but forwarded Toolcraft flags do not include `--dry-run`. `packages/github-workflows/src/commands.ts` exposes `trufflehog-pr-scan`, and `packages/github-workflows/src/exec/trufflehog-pr-scan.ts` unconditionally executes `docker` and writes scan output files in `scanForSecrets`.

## Suspected Area

Forwarded workflow helper commands need root dry-run propagation and preview-only behavior for subprocess execution and output artifact writes.
