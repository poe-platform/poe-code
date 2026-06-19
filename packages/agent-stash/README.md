# agent-stash

Portable agent skill and hook sync for project, global, and secret GitHub Gist-backed agent configuration.

## Environment Variables

- `GITHUB_TOKEN`: GitHub token used for Gist operations. This is checked first.
- `GH_TOKEN`: GitHub token used when `GITHUB_TOKEN` is not set.

When neither variable is set, the CLI attempts `gh auth token` for Gist-backed commands.

## Config

Config is stored under `~/.agent-stash`.

- `~/.agent-stash/config.json`: named profiles and known Gist references.
- `~/.agent-stash/cache/<profile>.manifest.json`: last synced manifest baseline for three-way sync.
- `~/.agent-stash/backups/<backup-id>`: restorable local backups.
- `~/.agent-stash/ignore`: gitignore-style global ignore rules.
- `<cwd>/.agent-stashignore`: gitignore-style project ignore rules.

Named profiles store:

- `gistId`: the secret Gist id.
- `gistUrl`: optional canonical Gist URL.
- `lastPulledAt`: last successful download timestamp.
- `lastPushedAt`: last successful upload timestamp.

## CLI

```bash
agent-stash profile list
agent-stash profile add default <gist-id-or-url>
agent-stash upload --profile default --scope project --agent claude-code --yes
agent-stash download --profile default --scope project --agent claude-code --yes
agent-stash sync --profile default --scope project --agent claude-code --on-conflict fail --yes
agent-stash copy --from project --to global --agent claude-code --kind skill --name code-review --yes
agent-stash move --from global --to project --agent claude-code --kind skill --name global-only --yes
```

All SDK operations accept injected `cwd`, `homeDir`, filesystem, clock, and Gist client dependencies.
