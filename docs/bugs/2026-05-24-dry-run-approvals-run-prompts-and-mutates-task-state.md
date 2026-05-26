# Dry-run approvals run prompts and mutates task state

## Summary

Running `approvals run` with the root `--dry-run` option still opens the human approval provider and transitions the queued approval task on disk.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint on macOS with a fake `osascript` executable on `PATH`

## Reproduction

From the repository root, create a disposable project with a pending approval task and a fake `osascript` executable that records the approval prompt and returns `Approve`:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/.poe-code" "$probe/bin"
cat > "$probe/bin/osascript" <<'SH'
#!/bin/sh
printf 'executed:%s\n' "$*" >> "$FAKE_MARKER"
printf 'Approve\n'
SH
chmod +x "$probe/bin/osascript"
cat > "$probe/project/.poe-code/approvals.yaml" <<'YAML'
$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json
kind: task-store
version: 1
lists:
  approvals:
    approval-1:
      name: Probe approval
      state: pending
      description: ""
      created: 2026-05-24T00:00:00.000Z
      schemaVersion: 1
      approvalId: approval-1
      commandPath: missing
      params: {}
      message: Approve probe?
      declineInputPrompt: null
      enqueuedAt: 2026-05-24T00:00:00.000Z
      pid: null
      result: null
      error: null
YAML

(
  cd "$probe/project"
  PATH="$probe/bin:$PATH" FAKE_MARKER="$probe/osascript-marker" HOME="$probe/home" \
    /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run approvals run --approval-id approval-1
)

cat "$probe/osascript-marker" "$probe/project/.poe-code/approvals.yaml"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command exits successfully and prints `Done.` after invoking the fake `osascript` approval dialog.
- The pending task is rewritten from `state: pending` to `state: approved-failed` after approval is returned.
- The store gains a live `pid` and an `error` object when the fixture's deliberately missing command path fails after approval.

## Expected Behavior

With root `--dry-run`, running an approval must not prompt the human approval provider or transition stored approval state. It should preview the pending task and intended execution flow only.

## Impact

- A preview can display real interactive approval dialogs and consume or change queued work.
- Dry-run permanently transitions pending approval records and stores execution metadata.
- Users cannot safely audit approval behavior before authorizing or dispatching actions.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`, but forwarded Toolcraft flags do not include `--dry-run`. `packages/toolcraft/src/human-in-loop/runner.ts` calls the configured approval provider and fires task transitions through the YAML task store without preview handling.

## Suspected Area

Forwarded approvals commands need root dry-run propagation and execution guards before provider prompts or task state transitions.
