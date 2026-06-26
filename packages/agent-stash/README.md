# agent-stash

Portable agent skill and hook sync for project, global, secret GitHub Gist-backed, and archive-backed agent configuration.

`agent-stash` inventories native agent skills and hooks, moves them between project and user scopes, syncs them through secret Gists, and creates backups before local writes.

## Environment Variables

- `GITHUB_TOKEN`: GitHub token used for Gist operations. This is checked first.
- `GH_TOKEN`: GitHub token used when `GITHUB_TOKEN` is not set.
- `AGENT_STASH_LOG`: optional JSONL diagnostic trace for upload, download, sync, and browse operations.
  - Unset, `0`, or `false`: tracing is disabled.
  - `1` or `true`: append to `~/.agent-stash/logs/trace.jsonl`.
  - Any other value: append to that path.

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

Supported options are:

- Scopes: `project`, `global`.
- Locations for copy/move: `project`, `global`, `gist`. Archives are handled through `export` and `import`.
- Item kinds: `skill`, `hook`.
- Conflict policies: `ask`, `local`, `remote`, `newer`, `fail`.

Project and global item paths are derived from the agent's declarative skill and hook configs. Pass canonical agent ids or aliases; they are normalized before inventory or writes.

## CLI

```bash
agent-stash
agent-stash browse --profile default --scope project --agent claude-code
agent-stash profile list
agent-stash profile add default <gist-id-or-url>
agent-stash profile rename default work
agent-stash profile remove work
agent-stash upload --profile default --scope project --agent claude-code --yes
agent-stash download --profile default --scope project --agent claude-code --yes
agent-stash sync --profile default --scope project --agent claude-code --on-conflict fail --yes
agent-stash copy --from project --to global --agent claude-code --kind skill --name code-review --yes
agent-stash move --from global --to project --agent claude-code --kind skill --name global-only --yes
agent-stash --log ./agent-stash.trace.jsonl sync --profile default --scope project --agent claude-code --on-conflict fail --yes
agent-stash export ./agent-stash.tgz --scope project --agent claude-code
agent-stash import ./agent-stash.tgz --scope project --agent claude-code --yes
agent-stash backup list
agent-stash backup restore <backup-id> --yes
agent-stash backup remove <backup-id>
```

Running `agent-stash` or `agent-stash browse` in a TTY opens the two-pane browser. The browser compares the selected local scope against the counterpart local scope, or against a Gist when `--profile` is provided. It supports multi-select copy, move, upload, download, and sync actions. In non-interactive contexts it prints a static browser view.

`upload`, `download`, and `sync` accept comma-separated `--skills <names>` and `--hooks <names>` selections. Hook selections can name a whole hook command family; for example a selection of `pre-commit` matches stored hook items whose names start with `pre-commit-`.

`--yes` enables non-interactive defaults:

- upload and sync default to `--profile default` when no `--profile` or `--gist` is provided.
- copy/move to a Gist defaults to `--profile default`.
- upload, download, and sync default to `--scope project --agent claude-code`.

Without `--yes`, missing profiles, scopes, agents, item selections, and conflict decisions are prompted when stdin/stdout are interactive.

## Gists and archives

`upload` creates a new secret Gist when the selected profile does not exist and no explicit `--gist` is provided. Explicit Gist ids or URLs can be passed with `--gist` or as the positional `download [gist]` argument.

`sync` uses the profile baseline manifest under `~/.agent-stash/cache/` for three-way local/remote sync. It reports uploaded, downloaded, deleted-local, deleted-remote, unchanged, and conflict counts.

`export` writes a gzipped tar archive containing the stash manifest and item files. It can export local inventory with `--scope` and `--agent`, or remote inventory with `--profile`/`--gist`. `import` validates archive paths, entry types, and file hashes before writing selected local items.

## Safety

- Local writes create backups before replacing files. Use `backup list`, `backup restore`, and `backup remove` to manage them.
- Ignore files are honored for inventory, downloads, imports, and sync writes.
- Archive imports reject unsupported entry types, path traversal, untracked files, and hash mismatches.
- Backup metadata and ignore files are checked for symlink escapes before they are trusted.
- Empty selections are preserved, so explicit `--skills ""` or `--hooks ""` does not silently expand to all items.

## SDK

All SDK operations accept injected `cwd`, `homeDir`, filesystem, clock, and Gist client dependencies.
