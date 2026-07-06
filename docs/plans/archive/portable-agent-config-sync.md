---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Portable Agent Config Sync

Portable `.claude` and `.codex` skills/hooks management with secret GitHub Gists as the transport layer.

## 1. What we're building

Build `agent-stash`, a portable agent-config feature for moving, copying, uploading, downloading, and syncing agent skills and hooks across project-local config, global user config, and secret GitHub Gists.

The user-facing command family has three sync-oriented operations:

- `agent-stash upload`
- `agent-stash download`
- `agent-stash sync`

`upload` opens a guided picker that starts from Claude Code as the baseline agent surface:

1. Pick skills.
2. Pick hooks.

The feature must support both Claude Code and Codex config:

- Claude Code is the baseline for native skills and hooks.
- Codex support builds on existing symlinking/regeneration behavior instead of inventing a separate manual Codex-only path.
- Agent-specific paths, formats, and transforms come from the existing provider/config registries, never hard-coded or branched per agent.

Secret GitHub Gists are the transport layer:

- Uploaded bundles are stored in secret Gists.
- Local `agent-stash` config stores the known gist references so later downloads, syncs, browsing, and copy/move operations do not require the user to paste IDs repeatedly.
- The Gist payload must carry enough metadata to compare timestamps and know whether local, global, or remote state is older.

`download` pulls a selected remote bundle from a known or provided Gist and materializes it into project-local or global user agent config.

`sync` compares timestamps between project-local/global agent config and the matching secret Gist payload, then updates the oldest side from the newest side.

The feature also includes direct project-local/global movement:

- Move skills from project-local config to global user config.
- Copy skills from project-local config to global user config.
- Move skills from global user config to project-local config.
- Copy skills from global user config to project-local config.
- Do the same for hooks where the source and target agent config support it.

The richer interactive surface is a two-pane terminal UI inspired by Midnight Commander:

- One pane can point at project-local config.
- One pane can point at global user config.
- A pane can also point at known Gist-backed remote config.
- The user can switch panes, browse skills/hooks, upload to Gist, download from Gist, and move/copy between panes.

The CLI remains the primary test surface:

- Every TUI action must be backed by SDK functions and a non-interactive CLI command.
- The TUI calls the SDK behind the scenes.
- CLI commands are used for automated and manual validation before validating the TUI.

Explicit non-goals for the first implementation:

- No branch workflow.
- No provider-specific branching outside declarative agent config/registry data.
- No dry-run command mode.
- No standalone doctor/validate command.
- No agent conversion preview command.
- No secret scanner.
- No README changes without separate user permission.
- No GitHub workflow unit tests.

## 2. User-facing shape

The npm package and executable are both named `agent-stash`.

```bash
npm install -g agent-stash
agent-stash --help
```

The command vocabulary uses three storage locations:

- `project`: the current project's agent config, such as `.claude/skills`, `.claude/settings.json`, `.codex/skills`, and `.codex/hooks.json`.
- `global`: the user's agent config, such as `~/.claude/skills`, `~/.claude/settings.json`, `~/.codex/skills`, and `~/.codex/hooks.json`.
- `gist`: the remote secret GitHub Gist attached to a named profile.

Named profiles are first-class. A profile stores the secret Gist reference and the latest known manifest metadata.

```bash
agent-stash profile list
agent-stash profile add default <gist-id-or-url>
agent-stash profile remove default
agent-stash profile rename default work
```

`upload` writes selected project/global skills and hooks into the profile's secret Gist. With missing flags in an interactive terminal, it prompts for profile, scope, agent, skills, and hooks. With `--yes`, it accepts defaults only where a default is defined.

```bash
agent-stash upload
agent-stash upload --profile default --scope project --agent claude-code
agent-stash upload --profile work --scope global --agent claude-code --skills code-review,commit-helper --hooks PreToolUse,Stop --yes
agent-stash upload --gist <gist-id-or-url> --scope project --agent codex --yes
```

Interactive `upload` flow:

```text
agent-stash upload

Profile
  default
  work
  + create new profile

Source
  Project
  Global

Agent
  Claude Code
  Codex

Skills
  [x] code-review
  [x] commit-helper
  [ ] experimental-local

Hooks
  [x] PreToolUse
  [x] Stop
  [ ] UserPromptSubmit

Upload 4 items to profile "default"?
```

`download` pulls a known profile, a Gist ID, or a Gist URL into project or global config.

```bash
agent-stash download
agent-stash download --profile default --scope project --agent claude-code
agent-stash download <gist-id-or-url> --scope global --agent codex --yes
```

`sync` compares per-item content hashes and timestamps between a profile's Gist and the selected project/global target. It updates the older side when only one side changed. When both sides changed, it follows the selected conflict policy.

```bash
agent-stash sync
agent-stash sync --profile default --scope project --agent claude-code
agent-stash sync --profile work --scope global --agent codex --on-conflict ask
agent-stash sync --profile work --scope project --agent claude-code --on-conflict remote --yes
```

Conflict policies:

- `ask`: prompt per conflict; default in interactive mode.
- `local`: keep project/global content and upload it to the Gist.
- `remote`: keep Gist content and download it to project/global config.
- `newer`: use the item with the newest timestamp.
- `fail`: stop when any conflict is found; default when non-interactive and no policy is provided.

`copy` and `move` transfer selected items between project, global, and gist locations.

```bash
agent-stash copy --from project --to global --agent claude-code --kind skill --name code-review
agent-stash copy --from global --to project --agent codex --kind hook --name PreToolUse
agent-stash move --from project --to global --agent claude-code --kind skill --name commit-helper
agent-stash copy --from gist --to project --profile default --agent claude-code --kind skill --name code-review
```

`export` and `import` support archive-based transfer without GitHub.

```bash
agent-stash export ./agent-stash-default.tar.gz --profile default
agent-stash import ./agent-stash-default.tar.gz --scope project --agent claude-code
```

Every destructive write creates a restorable backup before modifying files. Backups are user-facing because they are the recovery mechanism that replaces dry-run workflows.

```bash
agent-stash backup list
agent-stash backup restore <backup-id>
agent-stash backup remove <backup-id>
```

Ignore rules live in `.agent-stashignore` for project scope and `~/.agent-stash/ignore` for global scope. Ignore syntax follows gitignore-style path patterns and applies before upload, sync, copy, move, and export.

```gitignore
*.local.md
secrets/**
.claude/skills/private-client/**
```

Remote Gists use a stable manifest file plus item files. Source scope is a path segment so one profile can hold both project and global variants of the same item without collision. Hooks are stored as per-event fragments that carry only the hook subtree for that event, never the whole `settings.json`:

```text
agent-stash.json
skills/project/claude-code/code-review/SKILL.md
skills/global/claude-code/commit-helper/SKILL.md
hooks/project/claude-code/PreToolUse.json
hooks/project/claude-code/Stop.json
hooks/project/codex/PreToolUse.json
```

`agent-stash.json` records schema version, profile name, agent ids, item names, item kind, source scope, updated timestamps, content hashes, and archive compatibility metadata. The last-synced baseline used for conflict detection is not stored in the Gist; it lives in a local per-profile manifest cache (see §3).

Two-pane TUI launches with `browse`.

```bash
agent-stash browse
agent-stash browse --profile default
```

TUI layout:

```text
┌ Project: .claude                         ┐ ┌ Gist: default                         ┐
│ skills/                                  │ │ skills/                               │
│   [modified] code-review                 │ │   [remote-newer] code-review          │
│   commit-helper                          │ │ hooks/                                │
│ hooks/                                   │ │   [conflict] PreToolUse               │
│   PreToolUse                             │ │                                       │
│   Stop                                   │ │                                       │
├──────────────────────────────────────────┤ ├───────────────────────────────────────┤
│ / search   tab switch   space select     │ │ c copy   m move   u upload   s sync   │
└──────────────────────────────────────────┘ └───────────────────────────────────────┘
```

TUI commands:

- `/`: search/filter current pane.
- `tab`: switch active pane.
- `space`: select/unselect item.
- `c`: copy selected item(s) to the other pane.
- `m`: move selected item(s) to the other pane.
- `u`: upload selected item(s) to the active profile Gist.
- `d`: download selected item(s) from the active profile Gist.
- `s`: sync selected item(s).
- `b`: list backups and restore.
- `q`: quit.

The TUI is not a separate implementation. It calls the same SDK operations used by the CLI commands.

## 3. Implementation details and technical decisions

Autonomy audit:

- GitHub credentials are required for Gist-backed operations. `agent-stash` resolves auth in this order: explicit `GITHUB_TOKEN`, `GH_TOKEN`, then `gh auth token`. The token must carry the `gist` scope; on a missing-scope `403` the command fails citing that cause. If no token is available, commands that need Gist access fail before touching local files.
- Network access is required only for `gist` operations. Project/global copy, move, backup, restore, export, and import work offline.
- A real GitHub account is required for final manual Gist QA. Unit and CLI tests use an in-memory `GistClient`.
- Project-local config requires a working directory. Commands default to `process.cwd()` and accept `--cwd <path>` for tests and scripted usage.
- Global config requires a home directory. Commands default to `os.homedir()` and accept `--home <path>` for tests and scripted usage.
- Archive import/export requires tarball support via the `tar` package, added as a runtime dependency of `packages/agent-stash` (no existing repo dependency provides it).
- No human input is needed mid-run when flags are complete. Interactive prompts only happen when required flags are omitted and stdin is a TTY.

Create a separate package at `packages/agent-stash/` that owns all domain logic. The root package may depend on it during repo development, but `agent-stash` is designed to publish as its own npm package with its own binary.

Core implementation modules:

- `manifest.ts`: schema, parser, serializer, migration from older manifest versions.
- `inventory.ts`: discovers project/global skills and hooks for supported agents.
- `locations.ts`: resolves `project`, `global`, `gist`, and `archive` locations.
- `gist-client.ts`: small GitHub Gist API wrapper plus in-memory test implementation.
- `profile-store.ts`: reads/writes `~/.agent-stash/config.json` and the per-profile sync baseline cache under `~/.agent-stash/cache/`.
- `hash.ts`: SHA-256 hashing for files and directories.
- `backup-store.ts`: creates/restores/removes backups under `~/.agent-stash/backups`.
- `ignore.ts`: loads `.agent-stashignore` and `~/.agent-stash/ignore`.
- `operations/upload.ts`: profile/Gist upload orchestration.
- `operations/download.ts`: Gist/archive download orchestration.
- `operations/sync.ts`: per-item sync planning and conflict resolution.
- `operations/copy-move.ts`: item movement between project/global/Gist/archive.
- `operations/archive.ts`: export/import tarball orchestration.
- `cli.ts`: commander-based CLI wired to SDK operations. Interactive prompts use `toolcraft-design` prompt primitives, never `@clack/prompts` or `chalk` directly.
- `tui.ts`: two-pane browser built on `toolcraft-design`. If its explorer primitive is single-pane, extend `toolcraft-design` with a reusable two-pane layout rather than rolling a separate TUI library.

Reuse existing agent packages rather than hard-coding paths:

- `@poe-code/agent-skill-config` provides supported skill agents and project/global skill directory resolution.
- `@poe-code/agent-hook-config` provides Claude/Codex hook paths, Claude hook reading, Codex hook writing, and Claude-to-Codex transform behavior.
- `@poe-code/agent-defs` provides agent id/alias normalization.
- `@poe-code/config-mutations` provides the deep-merge used to write Claude hook entries back into `settings.json` without clobbering unrelated keys.

Agent support in v1:

- Skills: every agent supported by `@poe-code/agent-skill-config`, with Claude Code and Codex as the tested baseline.
- Hooks: Claude Code and Codex only, matching `@poe-code/agent-hook-config`.
- Claude Code remains the baseline hook representation in Gist manifests. Codex hook payloads may be stored when the user explicitly uploads Codex hooks, but cross-agent regeneration prefers Claude Code source when available.

Storage conventions:

- Config: `~/.agent-stash/config.json`.
- Backups: `~/.agent-stash/backups/<backup-id>/`.
- Sync baseline cache: `~/.agent-stash/cache/<profile>.manifest.json` holds the last-synced manifest snapshot used as the three-way base.
- Global ignore file: `~/.agent-stash/ignore`.
- Project ignore file: `<cwd>/.agent-stashignore`.
- Gist manifest filename: `agent-stash.json`.

Manifest model:

```ts
interface AgentStashManifest {
  schemaVersion: 1;
  profile?: string;
  createdAt: string;
  updatedAt: string;
  items: AgentStashItem[];
}

interface AgentStashItem {
  id: string;
  kind: "skill" | "hook";
  agentId: string;
  name: string; // skill name, or hook event name (e.g. "PreToolUse")
  scope: "project" | "global";
  path: string;
  files: AgentStashFile[]; // skill: the skill's files; hook: one per-event fragment file
  updatedAt: string;
  contentHash: string;
}

interface AgentStashFile {
  path: string;
  size: number;
  sha256: string;
}
```

`id` is stable and derived from `scope`, `kind`, `agentId`, and `name`, not from local absolute paths, so project and global variants never collide inside one profile. `download --scope X` and `sync --scope X` operate on the items whose source scope is `X`; promoting or demoting an item across scopes is done with `copy`/`move`. File paths inside the manifest are relative to the bundle root. A hook item's single fragment file holds only that event's matcher groups (the shape `@poe-code/agent-hook-config` reads and writes), not the surrounding `settings.json`; `download` and `sync` deep-merge it into the target config and never overwrite unrelated keys.

Profile config:

```ts
interface AgentStashConfig {
  profiles: Record<string, AgentStashProfile>;
}

interface AgentStashProfile {
  gistId: string;
  gistUrl?: string;
  lastPulledAt?: string;
  lastPushedAt?: string;
}
```

The last-synced baseline is a plain `AgentStashManifest` snapshot cached at `~/.agent-stash/cache/<profile>.manifest.json`, not a field on the profile. Sync reads its per-item `contentHash` values as the three-way base.

GitHub Gist API:

- Create secret Gist: `POST /gists` with `public: false`.
- Read Gist: `GET /gists/{gist_id}`.
- Update Gist: `PATCH /gists/{gist_id}`.
- Never rely on Gist filename ordering.
- Store profile Gist references locally after successful create/add/upload/download.

Sync algorithm (three-way; the base is the cached last-synced manifest):

1. Load local inventory for the selected `scope` and `agent`.
2. Load the remote manifest from the profile/Gist.
3. Load the cached base manifest for the profile (empty on first sync).
4. Match items by stable `id`. For each id take up to three `contentHash` values: `local`, `remote`, `base`.
5. `local === remote` → unchanged.
6. Present only locally and absent from base → added locally → upload.
7. Present only remotely and absent from base → added remotely → download.
8. Both present and differ, `local === base` (only remote changed) → download.
9. Both present and differ, `remote === base` (only local changed) → upload.
10. Both present and differ, and both differ from base — or there is no base — → conflict → apply `--on-conflict`.
11. Present in base but missing on one side → that side deleted it → apply `--on-conflict` (default `fail` rather than silently propagating a delete).
12. Before any write or delete, create a backup containing every target path that may change.
13. After a successful sync, write the resulting manifest to the profile's baseline cache so the next sync has an accurate base.

Copy and move semantics:

- `from` and `to` must differ; Gist-to-Gist is not supported in v1.
- `copy` writes the item into the target and leaves the source untouched.
- `move` writes the target first, then removes the source only after the target write succeeds.
- A `move` whose source is `gist` removes the item file from the Gist with a `PATCH` that sets that file to `null`. It stays recoverable: the item now also exists at the local target, and GitHub retains prior Gist revisions.
- A `move` whose source is `project`/`global` backs up the removed source files first, like any other destructive local write.

Backups:

- Backups are created for download, sync, move, import, and copy-to-existing-target.
- Backup metadata records command, args, timestamp, cwd, homeDir, target scope, target agent, and affected paths.
- Restore refuses to write outside the original recorded target roots unless the user passes the matching `--cwd` or `--home`.
- Backup creation is atomic enough for local recovery: write into a temp directory, then rename into the final backup id.
- Retention is bounded: keep the 20 most recent backups and prune older ones automatically after each successful destructive command. `backup remove` deletes a specific backup on demand.

Safety:

- Refuse to follow symlinks for files that will be overwritten or deleted.
- Refuse path traversal in manifests and archives.
- Refuse absolute paths in manifests and archives.
- Refuse to overwrite unrelated generated files unless the command explicitly targets that item.
- Gist download/import parses manifest before extracting or writing item files.

No dry-run:

- Commands show a concise operation summary before destructive interactive operations.
- Non-interactive operations require `--yes` for writes that can overwrite or delete.
- Backups are mandatory for destructive writes and are the rollback mechanism.

## 4. Interfaces and test plan

SDK boundary:

```ts
type AgentStashScope = "project" | "global";
type AgentStashLocationKind = "project" | "global" | "gist" | "archive";
type AgentStashKind = "skill" | "hook";
type ConflictPolicy = "ask" | "local" | "remote" | "newer" | "fail";

interface AgentStashContext {
  cwd: string;
  homeDir: string;
  fs: AgentStashFileSystem;
  gistClient?: GistClient;
  now?: () => Date;
}

interface UploadOptions {
  profile?: string;
  gist?: string;
  scope: AgentStashScope;
  agent: string;
  skills?: string[];
  hooks?: string[];
  yes?: boolean;
}

interface DownloadOptions {
  profile?: string;
  gist?: string;
  scope: AgentStashScope;
  agent: string;
  yes?: boolean;
}

interface SyncOptions {
  profile?: string;
  gist?: string;
  scope: AgentStashScope;
  agent: string;
  onConflict: ConflictPolicy;
  yes?: boolean;
}

interface CopyMoveOptions {
  operation: "copy" | "move";
  from: AgentStashLocationKind;
  to: AgentStashLocationKind;
  profile?: string;
  agent: string;
  kind: AgentStashKind;
  name: string;
  yes?: boolean;
}

function uploadBundle(ctx: AgentStashContext, options: UploadOptions): Promise<UploadResult>;
function downloadBundle(ctx: AgentStashContext, options: DownloadOptions): Promise<DownloadResult>;
function syncBundle(ctx: AgentStashContext, options: SyncOptions): Promise<SyncResult>;
function copyOrMoveItem(ctx: AgentStashContext, options: CopyMoveOptions): Promise<CopyMoveResult>;
function exportArchive(ctx: AgentStashContext, options: ExportOptions): Promise<ExportResult>;
function importArchive(ctx: AgentStashContext, options: ImportOptions): Promise<ImportResult>;
function createBackup(ctx: AgentStashContext, options: CreateBackupOptions): Promise<BackupRecord>;
function restoreBackup(
  ctx: AgentStashContext,
  options: RestoreBackupOptions
): Promise<RestoreResult>;
```

`GistClient` is injected:

```ts
interface GistClient {
  createSecret(input: GistWriteInput): Promise<GistRecord>;
  read(gistId: string): Promise<GistRecord>;
  update(gistId: string, input: GistWriteInput): Promise<GistRecord>;
}
```

Unit tests use `memfs` and `InMemoryGistClient`. They do not write test files to disk.

Dummy test data strategy:

- Add `packages/agent-stash/src/test-support/dummy-config.ts`.
- Export `createDummyAgentConfigFixture()` for unit tests.
- The fixture builds a dense in-memory tree with project/global Claude and Codex data, multiple profiles, ignored files, conflicting edits, remote-only items, local-only items, and archive-ready bundles.
- Every operation test starts by cloning the fixture so tests do not share mutable state.

Baseline dummy tree:

```text
/repo/.claude/skills/code-review/SKILL.md
/repo/.claude/skills/commit-helper/SKILL.md
/repo/.claude/skills/project-only/SKILL.md
/repo/.claude/settings.json
/repo/.codex/skills/codex-project/SKILL.md
/repo/.codex/hooks.json
/repo/.agent-stashignore
/home/user/.claude/skills/code-review/SKILL.md
/home/user/.claude/skills/global-only/SKILL.md
/home/user/.claude/settings.json
/home/user/.codex/skills/codex-global/SKILL.md
/home/user/.codex/hooks.json
/home/user/.agent-stash/config.json
/home/user/.agent-stash/ignore
```

Dummy Gist contents:

```text
agent-stash.json
skills/project/claude-code/code-review/SKILL.md
skills/project/claude-code/remote-only/SKILL.md
hooks/project/claude-code/PreToolUse.json
hooks/project/codex/PreToolUse.json
```

Unit test matrix:

- Inventory discovers project Claude skills.
- Inventory discovers global Claude skills.
- Inventory discovers project Codex skills.
- Inventory discovers global Codex skills.
- Inventory reads Claude project hooks.
- Inventory reads Claude global hooks.
- Inventory reads Codex project hooks.
- Inventory reads Codex global hooks.
- Ignore rules exclude matching project items.
- Ignore rules exclude matching global items.
- Upload creates a secret Gist when no Gist exists.
- Upload updates an existing profile Gist.
- Upload stores manifest and item files with stable relative paths.
- Upload persists profile Gist references after success.
- Download materializes remote skills into project scope.
- Download materializes remote skills into global scope.
- Download materializes remote hooks into project scope.
- Download creates a backup before overwriting.
- Sync uploads local-only items.
- Sync downloads remote-only items.
- Sync skips unchanged items by hash even when timestamps differ.
- Sync resolves local-newer with `--on-conflict local`.
- Sync resolves remote-newer with `--on-conflict remote`.
- Sync resolves timestamp winner with `--on-conflict newer`.
- Sync fails on conflict with `--on-conflict fail`.
- Copy project-to-global skill preserves file content.
- Copy global-to-project skill preserves file content.
- Move project-to-global skill removes only the source item after target write succeeds.
- Copy Gist-to-project skill works through `InMemoryGistClient`.
- Export writes archive manifest and files.
- Import reads archive manifest and materializes files.
- Backup restore returns overwritten files to their previous content.
- Hook items are stored as per-event fragments, not as a whole `settings.json`.
- Upload of a hook never includes non-hook `settings.json` keys (permissions, env, model).
- Download deep-merges a hook fragment into an existing `settings.json` without dropping unrelated keys.
- Project and global items with the same name coexist in one profile without collision.
- Sync uploads when only the local item changed relative to the base manifest.
- Sync downloads when only the remote item changed relative to the base manifest.
- Sync flags a conflict when both sides differ from the base manifest.
- Sync flags a conflict on first sync (no base) when the two sides differ.
- Sync writes the baseline cache after a successful run.
- Move from Gist removes the item file from the Gist after the local target write succeeds.
- Manifest parser rejects absolute paths.
- Manifest parser rejects `..` traversal.
- Archive import rejects paths outside bundle root.
- Overwrite target symlink is refused.
- Non-interactive destructive command without `--yes` fails before writing.

CLI tests:

- Use `memfs` where the command runner supports injected dependencies.
- Use an injected in-memory Gist client rather than the real GitHub API.
- Cover every public command with complete flags so tests never rely on prompts.
- Snapshot only concise command output when it is stable.

Real-world porting QA:

1. Create a sandbox with project and home directories.
2. Seed dummy Claude and Codex project/global skills and hooks.
3. Run `agent-stash profile add default <test-gist-id>` or let upload create a secret Gist.
4. Run `agent-stash upload --profile default --scope project --agent claude-code --yes`.
5. Remove the project `.claude/skills` and `.claude/settings.json`.
6. Run `agent-stash download --profile default --scope project --agent claude-code --yes`.
7. Confirm the restored files match the original seeded files by hash.
8. Modify one local skill and one remote Gist skill.
9. Run `agent-stash sync --profile default --scope project --agent claude-code --on-conflict fail --yes` and confirm it fails without writing.
10. Run `agent-stash sync --profile default --scope project --agent claude-code --on-conflict local --yes` and confirm the Gist receives the local version.
11. Run `agent-stash copy --from project --to global --agent claude-code --kind skill --name code-review --yes`.
12. Confirm the global skill file matches the project skill file.
13. Run `agent-stash move --from global --to project --agent claude-code --kind skill --name global-only --yes`.
14. Confirm the project receives the skill and the global source is removed.
15. Run `agent-stash export ./stash.tar.gz --profile default`.
16. Remove the configured profile and local project files.
17. Run `agent-stash import ./stash.tar.gz --scope project --agent claude-code --yes`.
18. Confirm imported files match the exported manifest hashes.
19. Run `agent-stash backup list`.
20. Run `agent-stash backup restore <latest-backup-id> --yes`.
21. Confirm restore returns the previous project tree.

Visual CLI/TUI QA:

- Run the workspace screenshot helper against `agent-stash --help`.
- Run the workspace screenshot helper against `agent-stash upload --help`.
- Run the workspace screenshot helper against `agent-stash sync --help`.
- Run `agent-stash browse` in a seeded sandbox and capture screenshots for project/global and project/Gist pane pairings.
- Verify no text overlaps, pane labels fit, selected rows are visible, and conflict/modified badges are legible.

Must-work checklist:

- [ ] `agent-stash upload --profile default --scope project --agent claude-code --yes` creates or updates a secret Gist and writes `agent-stash.json`.
- [ ] `agent-stash download --profile default --scope project --agent claude-code --yes` restores deleted project skills and hooks from the Gist.
- [ ] `agent-stash sync --on-conflict fail --yes` detects both-changed conflicts and writes nothing.
- [ ] `agent-stash sync --on-conflict local --yes` uploads the local conflicted item.
- [ ] `agent-stash sync --on-conflict remote --yes` downloads the remote conflicted item.
- [ ] `agent-stash copy --from project --to global --kind skill --name code-review --yes` copies exactly one skill.
- [ ] `agent-stash move --from global --to project --kind skill --name global-only --yes` removes the source only after the target is written.
- [ ] `agent-stash export` followed by `agent-stash import` preserves manifest hashes.
- [ ] `agent-stash backup restore <id> --yes` restores overwritten files.
- [ ] `agent-stash browse` can copy, move, upload, download, and sync through the same SDK calls as CLI commands.

## 5. Code plan

Files to create:

- `packages/agent-stash/package.json`: package metadata, scripts, dependencies, bin declaration.
- `packages/agent-stash/README.md`: package README with env vars and config options.
- `packages/agent-stash/tsconfig.json`: package TypeScript config.
- `packages/agent-stash/src/index.ts`: public SDK exports.
- `packages/agent-stash/src/bin.ts`: executable entrypoint.
- `packages/agent-stash/src/cli.ts`: command registration and CLI runner.
- `packages/agent-stash/src/types.ts`: shared public/internal types.
- `packages/agent-stash/src/error-codes.ts`: package error codes, matching the convention used across `@poe-code` packages.
- `packages/agent-stash/src/exports.compile-check.ts`: compile-time check that the public surface stays exported, matching the sibling config packages.
- `packages/agent-stash/src/manifest.ts`: manifest parser/serializer and path validation.
- `packages/agent-stash/src/locations.ts`: project/global/Gist/archive location resolution.
- `packages/agent-stash/src/inventory.ts`: skill/hook discovery and item loading.
- `packages/agent-stash/src/hash.ts`: content hashing utilities.
- `packages/agent-stash/src/gist-client.ts`: GitHub Gist client and auth resolution.
- `packages/agent-stash/src/profile-store.ts`: `~/.agent-stash/config.json` access.
- `packages/agent-stash/src/ignore.ts`: ignore loading and matching.
- `packages/agent-stash/src/backup-store.ts`: backup create/list/restore/remove.
- `packages/agent-stash/src/operations/upload.ts`: upload operation.
- `packages/agent-stash/src/operations/download.ts`: download operation.
- `packages/agent-stash/src/operations/sync.ts`: sync operation.
- `packages/agent-stash/src/operations/copy-move.ts`: copy/move operation.
- `packages/agent-stash/src/operations/archive.ts`: archive import/export operation.
- `packages/agent-stash/src/tui.ts`: two-pane TUI entrypoint.
- `packages/agent-stash/src/test-support/dummy-config.ts`: dense dummy data fixture generator.
- `packages/agent-stash/src/test-support/in-memory-gist-client.ts`: fake Gist client for tests.
- `packages/agent-stash/src/*.test.ts`: focused unit tests for each module.
- `packages/agent-stash/src/operations/*.test.ts`: operation tests over the dummy fixture.
- `packages/agent-stash/src/cli.test.ts`: command tests with injected fs and fake Gist client.

Files to change:

- No root `package.json` or `tsconfig.build.json` change is required: workspaces use the `packages/*` glob and the build does not use TypeScript project references. The package builds via its own `packages/agent-stash/tsconfig.json`.
- `docs/plans/portable-agent-config-sync.md`: keep this plan updated if scope changes during implementation.

Build order:

1. Scaffold package and empty exports.
2. Add manifest parser and path validation tests first.
3. Add dummy fixture and in-memory Gist client.
4. Add inventory for skills, then hooks.
5. Add profile store and Gist client abstraction.
6. Add backup store.
7. Add upload operation.
8. Add download operation.
9. Add sync planner and conflict policies.
10. Add copy/move operation.
11. Add archive import/export.
12. Add CLI commands on top of SDK operations.
13. Add TUI on top of SDK operations.
14. Run unit tests.
15. Run CLI fixture porting QA.
16. Run screenshot QA for CLI help and TUI.

Implementation constraints:

- TDD for every code change.
- Unit tests use `memfs`; they do not create real files.
- No regex parsing of config files. JSON is parsed with `JSON.parse` or `jsonc-parser` where comments must be supported. TOML is parsed with `smol-toml` if needed.
- Writing a Claude hook deep-merges its entries into `settings.json` via `@poe-code/config-mutations`; Codex hooks are written via `@poe-code/agent-hook-config`. Neither replaces the file wholesale.
- No provider-specific branching outside declarative agent config registries and per-format adapters.
- No functions that only proxy to another function.
- No dry-run plumbing.
- No README changes outside `packages/agent-stash/README.md` without separate permission.

## 6. Acceptance criteria

This is the complete definition of done. The §4 must-work checklist is the P0 smoke subset of it. Every box below is a single verifiable test. Unit and CLI criteria run with `memfs` + `InMemoryGistClient` — no real disk, no network, no LLM — and read timestamps from injected `ctx.now` so results are deterministic. Criteria marked `(manual QA)` are validated by a checked step in the real-world porting QA or the screenshot QA; everything else has an automated test. A capability ships only when every box in its group passes.

### 6.1 Profiles

- [ ] `profile add <name> <gist-id>` stores a profile whose `gistId` is the bare id.
- [ ] `profile add <name> <gist-url>` stores the canonical `gistUrl` and the id extracted from it.
- [ ] `profile add <existing-name> ...` fails and leaves the existing profile unchanged.
- [ ] `profile list` prints each profile with its `gistId`, `lastPushedAt`, and `lastPulledAt`, and exits 0 with an explicit empty-state line when there are none.
- [ ] `profile remove <name>` deletes only that profile and its baseline cache; other profiles remain.
- [ ] `profile remove <missing>` fails with a not-found error, non-zero exit, and no mutation.
- [ ] `profile rename <old> <new>` moves the profile and its baseline cache and leaves no `<old>` entry.
- [ ] `profile rename <old> <existing>` fails without overwriting `<existing>`.

### 6.2 GitHub auth and Gist client

- [ ] Auth resolves `GITHUB_TOKEN`, then `GH_TOKEN`, then `gh auth token`, stopping at the first present value.
- [ ] A Gist-dependent command with no token fails before any local read or write, citing missing credentials.
- [ ] A token without the `gist` scope surfaces the scope as the explicit cause on a `403`.
- [ ] `createSecret` issues `POST /gists` with `public: false`; the created Gist is never public.
- [ ] Reads tolerate arbitrary Gist file ordering — no behavior depends on returned key order.
- [ ] No automated test performs real GitHub network I/O; all use `InMemoryGistClient`.

### 6.3 Inventory and discovery

- [ ] Discovers project Claude skills under `.claude/skills`.
- [ ] Discovers global Claude skills under `~/.claude/skills`.
- [ ] Discovers project Codex skills.
- [ ] Discovers global Codex skills.
- [ ] Reads Claude project hooks from `.claude/settings.json` as per-event entries.
- [ ] Reads Claude global hooks from `~/.claude/settings.json` as per-event entries.
- [ ] Reads Codex project hooks from `.codex/hooks.json`.
- [ ] Reads Codex global hooks from `~/.codex/hooks.json`.
- [ ] Skill agents come from `@poe-code/agent-skill-config` and hook agents from `@poe-code/agent-hook-config`; no agent id is hard-coded in a branch.
- [ ] An empty config tree yields an empty inventory, not an error.

### 6.4 Ignore rules

- [ ] `.agent-stashignore` excludes matching project items from upload, sync, copy, move, and export.
- [ ] `~/.agent-stash/ignore` excludes matching global items from the same operations.
- [ ] Gitignore-style patterns (`*.local.md`, `secrets/**`, nested directory globs) match with gitignore semantics.
- [ ] Ignored items never appear in a written manifest, an uploaded Gist, or an export archive.
- [ ] Ignore matching is applied before hashing and selection, not after.

### 6.5 Upload

- [ ] `upload --profile P --scope project --agent claude-code --yes` with no existing Gist creates a secret Gist and writes `agent-stash.json`.
- [ ] Upload to an existing profile Gist updates it via `PATCH` and preserves unrelated Gist files.
- [ ] Uploaded item files use stable bundle-relative paths including the scope segment (e.g. `skills/project/...`).
- [ ] A hook upload writes a per-event fragment containing only that event's matcher groups.
- [ ] A hook upload never includes non-hook `settings.json` keys (permissions, env, model).
- [ ] After a successful upload, the profile's `gistId`/`gistUrl` and `lastPushedAt` are persisted.
- [ ] `--skills a,b` and `--hooks X,Y` upload exactly the named items and nothing else.
- [ ] `upload --gist <id>` with no profile uploads to the given Gist without a stored profile.
- [ ] Uploading identical content twice is idempotent: same item hashes, no spurious file churn.

### 6.6 Download

- [ ] `download --profile P --scope project --agent claude-code --yes` materializes remote skills into `.claude/skills`.
- [ ] Download into global scope writes under `~/.claude/...`.
- [ ] Downloading a hook fragment deep-merges it into the target `settings.json`/`hooks.json` without dropping unrelated keys.
- [ ] Download by raw `<gist-id>` and by `<gist-url>` both work without a stored profile.
- [ ] Download creates a backup of every file it will overwrite before writing.
- [ ] After deleting local files and downloading, restored content matches the Gist by hash.
- [ ] `download --scope X` materializes only items whose source scope is `X`.

### 6.7 Sync (three-way)

- [ ] Equal local and remote hashes are reported unchanged and not rewritten.
- [ ] An item present only locally and absent from base is uploaded.
- [ ] An item present only remotely and absent from base is downloaded.
- [ ] An item where only the remote changed (`local === base`) is downloaded.
- [ ] An item where only the local changed (`remote === base`) is uploaded.
- [ ] An item where both sides differ from base is a conflict.
- [ ] On first sync with no base, two differing sides are a conflict, never silently merged.
- [ ] A successful sync writes the resulting manifest to the baseline cache.
- [ ] `--on-conflict local` keeps local and uploads it.
- [ ] `--on-conflict remote` keeps remote and downloads it.
- [ ] `--on-conflict newer` selects the newest `updatedAt` and applies that direction.
- [ ] `--on-conflict fail` stops on the first conflict and writes nothing on either side.
- [ ] `--on-conflict ask` is the interactive default and prompts once per conflict.
- [ ] Non-interactive sync with no `--on-conflict` defaults to `fail`.
- [ ] A deletion (present in base, absent on one side) follows `--on-conflict`, defaults to `fail`, and never silently propagates a delete.
- [ ] Items unchanged by hash are skipped even when their timestamps differ.

### 6.8 Copy and move

- [ ] `copy --from project --to global --kind skill --name N` copies exactly that skill, content-identical, with the source untouched.
- [ ] `copy --from global --to project ...` works in reverse.
- [ ] `copy --from gist --to project --profile P ...` materializes the item through the Gist client.
- [ ] `move --from project --to global ...` writes the target first and removes the source only after the target write succeeds.
- [ ] `move` backs up removed local source files before deleting them.
- [ ] `move --from gist ...` removes the Gist item file (PATCH file → `null`) only after the local target write succeeds, and the prior content remains recoverable via the local copy and Gist revision history.
- [ ] `from` equal to `to` is rejected.
- [ ] Gist-to-Gist copy or move is rejected in v1.
- [ ] Copying or moving onto an existing target backs up the overwritten target first.

### 6.9 Export and import (archive)

- [ ] `export <file>.tar.gz --profile P` writes a tarball containing `agent-stash.json` and all item files with matching hashes.
- [ ] `import <file>.tar.gz --scope project --agent claude-code --yes` materializes files whose hashes equal the archive manifest.
- [ ] Export then import round-trips with zero GitHub access.
- [ ] Import rejects archive entries with absolute paths or `..` traversal.
- [ ] Import backs up existing targets before overwriting them.

### 6.10 Backups and restore

- [ ] Backups are created for download, sync, move, import, and copy-to-existing-target, and only for destructive writes.
- [ ] Backup metadata records command, args, timestamp, cwd, homeDir, target scope, target agent, and affected paths.
- [ ] `backup list` shows id, command, timestamp, and target for each backup, newest first.
- [ ] `backup restore <id> --yes` returns every recorded file to its pre-write content.
- [ ] Restore refuses to write outside the recorded target roots unless matching `--cwd`/`--home` is passed.
- [ ] `backup remove <id>` deletes exactly that backup and no other.
- [ ] After a destructive command, retention prunes to the 20 most recent backups.
- [ ] Backup creation is atomic: a crash mid-backup leaves no half-written backup id (temp dir then rename).

### 6.11 Manifest schema and safety

- [ ] Manifest parser rejects absolute item paths.
- [ ] Manifest parser rejects `..` traversal in item paths.
- [ ] Archive import rejects any path resolving outside the bundle root.
- [ ] Overwriting or deleting through a symlink is refused.
- [ ] `id` is derived from `scope` + `kind` + `agentId` + `name`; project and global same-name items coexist without collision.
- [ ] A manifest at an older `schemaVersion` is migrated on read; an unknown newer version fails with a clear message.
- [ ] Gist download and archive import parse the manifest before writing any item file.

### 6.12 CLI/SDK parity and non-interactive behavior

- [ ] Every public command is reachable via a fully-flagged invocation that triggers no prompt.
- [ ] Every TUI action maps to the identical SDK call used by its CLI command.
- [ ] A non-interactive destructive command without `--yes` fails before writing.
- [ ] `--yes` accepts a default only where one is defined and never invents a conflict policy other than the documented `fail`.
- [ ] `--cwd` and `--home` override `process.cwd()`/`os.homedir()` for project and global resolution.
- [ ] Interactive prompts fire only when a required flag is omitted and stdin is a TTY.
- [ ] Exit code is 0 on success and non-zero on any refused or failed operation.

### 6.13 TUI (`browse`)

- [ ] `/` filters the active pane.
- [ ] `tab` switches the active pane.
- [ ] `space` toggles item selection.
- [ ] `c`, `m`, `u`, `d`, `s`, `b` invoke copy, move, upload, download, sync, and backups through the same SDK operations as the CLI.
- [ ] Pane labels, status badges (`modified`, `remote-newer`, `conflict`), and selected rows render without overlap or truncation. (manual QA)
- [ ] `q` exits cleanly with no partial writes.

### 6.14 Determinism and test hygiene

- [ ] Unit and CLI tests create no real files; snapshots are the sole on-disk exception.
- [ ] No test performs network or LLM calls.
- [ ] Each operation test clones the dummy fixture so no test mutates shared state.
- [ ] Timestamp assertions read injected `ctx.now`, never wall-clock.
