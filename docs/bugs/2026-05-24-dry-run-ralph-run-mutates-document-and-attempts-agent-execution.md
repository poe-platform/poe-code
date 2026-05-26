# Dry-run Ralph run mutates the document and attempts agent execution

## Summary

Running `ralph run` with `--dry-run` still enters an actual iteration, rewrites the Ralph markdown document frontmatter, and attempts to start the configured agent. In a credential-free disposable environment it fails only because no API key is available.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create an isolated Ralph document and run it in dry-run mode with no Poe API key available:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/docs/plans"

cat > "$probe/project/docs/plans/probe.md" <<'EOF'
---
agent: codex
iterations: 1
status:
  state: pending
  iteration: 0
---
# Probe

Do not run.
EOF

(
  cd "$probe/project"
  HOME="$probe/home" env -u POE_API_KEY npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes ralph run docs/plans/probe.md || true
)

cat "$probe/project/docs/plans/probe.md"
find "$probe/home/.poe-code" -type f -print -exec cat {} \; 2>/dev/null || true
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The output prints `Iteration 1/1 (codex)`, proving dry-run enters the live run path.
- The command fails with `No API key found`, indicating it attempts agent execution instead of producing a preview.
- The input Markdown file is changed on disk: schema/kind/version fields are added and `status.state` is normalized from `pending` to `open`.
- An error log is created under the disposable home at `.poe-code/logs/errors.log`.

## Expected Behavior

With `--dry-run`, `ralph run` must not run an iteration, invoke agent setup, rewrite the Ralph document, or create execution logs. It should display the document and iteration plan that would run.

## Impact

- A no-write simulation can mutate planning documents and execute agent workflows when credentials are available.
- Users may unintentionally incur external agent activity or costs while previewing a run.
- Failed previews still alter document state and create diagnostic artifacts.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/ralph.ts`, the `ralph run` handler resolves flags but invokes `sdkRunRalph` without a dry-run short-circuit, allowing the normal document and agent execution path to proceed.

## Suspected Area

`ralph run` needs an explicit dry-run preview path before invoking the SDK loop or any agent/runtime initialization.
