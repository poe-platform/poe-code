# Local skill configure follows a symlinked skill directory outside the project

## Summary

The `poe-code skill configure <agent> --local` command reports installation beneath the project's agent skill directory, but underlying mutation paths are resolved textually and do not verify canonical containment. If `.claude/skills` is a symlink to an external directory, local Claude skill configuration writes the bundled skill file outside the project.

## Reproduction

From the repository root, create a disposable project whose Claude local skills directory is symlinked externally, then run the local configuration command:

```sh
repo=$PWD
probe=$(mktemp -d)
home="$probe/home"
project="$probe/project"
outside="$probe/outside"
mkdir -p "$home" "$project/.claude" "$outside"
ln -s "$outside" "$project/.claude/skills"

(
  cd "$project" &&
  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes skill configure claude-code --local
)

find "$outside" -maxdepth 2 -type f -print -exec sed -n '1,2p' {} \;

nl -ba src/cli/commands/skill.ts | sed -n '33,130p'
nl -ba packages/agent-skill-config/src/apply.ts | sed -n '27,61p'
nl -ba packages/config-mutations/src/execution/path-utils.ts | sed -n '37,67p'
```

## Observed Behavior

The CLI reports that it configured the project-local Claude skill location, but the bundled skill is created in the external symlink target:

```text
Configured skills for claude-code at ./.claude/skills
.../outside/poe-generate.md
---
name: poe-generate
```

The user selects normal local scope and a supported built-in agent. The escape occurs only because `.claude/skills -> outside` is followed during directory and template-write mutations.

## Expected Behavior

Local skill installation should write only beneath the canonical current project directory. A project-local skill path that resolves outside the project via a symlink should be rejected before bundled skill content is written.

## Impact

A crafted project symlink can redirect normal persistent skill setup to arbitrary external writable directories while the CLI reports an in-project destination. This can overwrite or introduce agent instruction files outside the intended project scope.
