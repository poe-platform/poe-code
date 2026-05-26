# Dry-run superintendent complete rewrites document

## Summary

Running `superintendent complete` with the root `--dry-run` option still updates the selected plan document to the completed state and writes the supplied completion reason.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable superintendent document and preview manual completion:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/docs/plans"
cat > "$probe/project/docs/plans/probe.md" <<'DOC'
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
# Plan

## Task Board

- [ ] Keep this task open
DOC

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run superintendent complete docs/plans/probe.md --reason probe
)

cat "$probe/project/docs/plans/probe.md"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command exits successfully and reports `Marked docs/plans/probe.md as completed.`
- `status.state` is rewritten from `review` to `completed`.
- `status.reason: probe` is persisted, and document serialization also adds the schema field.

## Expected Behavior

With root `--dry-run`, completing a superintendent document must not rewrite frontmatter or any document contents. It should preview the transition only.

## Impact

- A supposedly non-mutating preview closes active workflow state.
- The action can alter review control flow and persist an operator reason without confirmation of a real mutation.
- Automated validation of completion behavior can modify plan documents.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `superintendent` is forwarded into Toolcraft, and `packages/superintendent/src/commands/complete.ts` always calls `fs.writeFile` after calculating the completed document without receiving a dry-run option.

## Suspected Area

Root execution flags need propagation to forwarded Toolcraft commands, and superintendent state mutation handlers need explicit preview semantics.
