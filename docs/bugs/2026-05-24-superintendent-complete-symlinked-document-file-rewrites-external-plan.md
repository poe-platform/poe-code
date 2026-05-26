# Superintendent complete follows a symlinked document file and rewrites an external plan

## Summary

The `superintendent complete` command accepts a Markdown document path and rewrites it to persist the completed state, but does not reject a symbolic link at that path. If a project-local plan link points outside the project, ordinary manual completion updates the external document and adds the supplied completion reason.

## Reproduction

From the repository root, expose an external superintendent document through the expected project plan path and complete it through the CLI:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/docs/plans" "$probe/outside"
cat > "$probe/outside/external.md" <<'DOC'
---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: |
    Work on {{plan.path}}
superintendent:
  agent: claude-code
  prompt: |
    Review {{builder.summary}}
owner:
  agent: claude-code
  prompt: |
    Review {{superintendent.summary}}
status:
  state: review
  round: 2
  review_turn: 3
---
# External Plan

## Task Board

- [ ] Remain open
DOC
ln -s "$probe/outside/external.md" "$probe/project/docs/plans/probe.md"

(
  cd "$probe/project"
  HOME="$probe/home" "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" superintendent complete docs/plans/probe.md --reason external-probe
)

ls -l "$probe/project/docs/plans/probe.md"
sed -n '1,38p' "$probe/outside/external.md"

nl -ba packages/superintendent/src/commands/complete.ts | sed -n '9,65p'
```

## Observed Behavior

The command reports a successful local completion while the symlink target outside the project is rewritten:

```text
Marked docs/plans/probe.md as completed.
Reason: external-probe
<probe>/project/docs/plans/probe.md -> <probe>/outside/external.md
```

The external document changes from `status.state: review` to `status.state: completed`, gains `status.reason: external-probe`, and is canonicalized with a `$schema` field. The command handler reads and writes `params.path` directly without validating its canonical location.

## Expected Behavior

Completing a project superintendent plan should mutate only canonical documents located within the selected project plan storage boundary. A symlinked document path escaping the project should be rejected rather than rewritten.

## Impact

A project can present an external Markdown file as a superintendent plan and cause routine manual completion to rewrite it outside the project boundary. This can silently close or annotate workflow state in unrelated documents while the CLI output identifies only the local symlink path.
