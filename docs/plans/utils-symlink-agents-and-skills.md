# utils symlink agents & skills

Two new `poe-code utils symlink` subcommands that keep agent-tool files interchangeable by promoting one canonical file and symlinking the legacy paths to it.

## 1. What we're building

Two new subcommands under the existing `poe-code utils` command:

**`poe-code utils symlink agents`** — keeps `AGENTS.md` and `CLAUDE.md` aligned in a workspace.

- If `AGENTS.md` exists and `CLAUDE.md` is missing → create symlink `CLAUDE.md -> AGENTS.md`.
- If `CLAUDE.md` exists and `AGENTS.md` is missing → rename `CLAUDE.md` to `AGENTS.md`, then create symlink `CLAUDE.md -> AGENTS.md`.
- If both exist as regular files → refuse (do not clobber), print diff hint, exit non-zero.
- If `CLAUDE.md` is already a symlink to `AGENTS.md` → no-op (idempotent).

**`poe-code utils symlink skills`** — moves skills from the Claude Code skill dir to the shared `.agents/skills` / `~/.agents/skills` dir and leaves the old path as a symlink. Scope (`--local` vs `--global`) follows the same UX as `poe-code skill configure`.

- Local scope (default when selected): `.claude/skills` ↔ `.agents/skills`.
- Global scope: `~/.claude/skills` ↔ `~/.agents/skills`.
- If the Claude dir is a regular directory and the `.agents` dir missing → `mv` claude → agents, then symlink claude → agents.
- If the `.agents` dir exists and the Claude dir missing → just create the symlink.
- If the Claude dir is already a symlink to the `.agents` dir → no-op.
- If both exist as directories → refuse, print a conflict message, exit non-zero.

Motivating context: makes a workspace interchangeable between Claude Code, Codex, Cursor, Goose, and other agent runtimes that look in different directories. `.agents/` mirrors Goose's convention (already in [`packages/agent-skill-config/src/configs.ts:25-28`](packages/agent-skill-config/src/configs.ts#L25-L28)).

**Out of scope:**

- VS Code extension packaging / on-save listeners. This is a CLI only.
- `syncOnStartup` behavior. The CLI runs once per invocation.
- Any agent other than Claude Code for the `skills` subcommand (Codex/opencode/Goose use separate directories that are already correct).
- Auto-discovery of nested workspaces. Operates on the current working directory only.
- Windows symlink support (Node `fs.symlink` requires admin on Windows). Document as unsupported; error out clearly if running on win32.

## 2. User-facing shape

### Help output

```text
$ poe-code utils symlink --help
Usage: poe-code utils symlink [options] [command]

Keep agent tool files interchangeable via symlinks.

Commands:
  agents   Symlink CLAUDE.md <- AGENTS.md (AGENTS.md is canonical).
  skills   Move .claude/skills into .agents/skills and symlink it back.
```

### `poe-code utils symlink agents`

```text
$ ls
CLAUDE.md

$ poe-code utils symlink agents
✔ renamed CLAUDE.md -> AGENTS.md
✔ created symlink CLAUDE.md -> AGENTS.md

$ ls -la
AGENTS.md
CLAUDE.md -> AGENTS.md
```

Idempotent second run:

```text
$ poe-code utils symlink agents
✔ already linked: CLAUDE.md -> AGENTS.md
```

Conflict:

```text
$ poe-code utils symlink agents
✖ both CLAUDE.md and AGENTS.md exist as regular files.
  Resolve manually: diff the files, keep the one you want as AGENTS.md,
  then re-run this command.
```

Flags:

- `--dry-run` — print what would happen, make no changes.
- `--cwd <dir>` — operate on `<dir>` instead of `process.cwd()` (mirrors existing commands' pattern).

No scope prompt for `agents` — AGENTS.md / CLAUDE.md are always project-root files. No `--yes` needed (no defaults to accept).

### `poe-code utils symlink skills`

Scope handling mirrors [`poe-code skill configure`](src/cli/commands/skill.ts) at [src/cli/commands/skill.ts:41-103](src/cli/commands/skill.ts#L41-L103):

- `--local` → operate on `./.claude/skills` ↔ `./.agents/skills`.
- `--global` → operate on `~/.claude/skills` ↔ `~/.agents/skills`.
- `--local` and `--global` are mutually exclusive; passing both errors out.
- Neither flag + `--yes` → defaults to `--global` (same default as `skill configure`).
- Neither flag + interactive → prompt via the design system `select`:

```text
$ poe-code utils symlink skills
? Select scope:
  › Global
    Local
```

Local run:

```text
$ poe-code utils symlink skills --local
✔ moved .claude/skills -> .agents/skills
✔ created symlink .claude/skills -> ../.agents/skills

$ ls -la .claude
skills -> ../.agents/skills
```

Global run:

```text
$ poe-code utils symlink skills --global
✔ moved ~/.claude/skills -> ~/.agents/skills
✔ created symlink ~/.claude/skills -> ../.agents/skills
```

Idempotent:

```text
$ poe-code utils symlink skills --local
✔ already linked: .claude/skills -> ../.agents/skills
```

Flags: `--dry-run`, `--cwd <dir>`, `--local`, `--global`, `-y, --yes`.

### Exit codes

- `0` — success or already-linked no-op.
- `1` — unresolvable conflict (both files/dirs present, not symlinks).
- `2` — platform not supported (win32) or permission error.

## 3. Implementation details and technical decisions

### Architecture

Add one new file per subcommand under [`src/cli/commands/`](src/cli/commands/), following the existing `registerXxxCommand(parent, container)` pattern used by [`src/cli/commands/config.ts:26-56`](src/cli/commands/config.ts#L26-L56) and registered from [`src/cli/commands/utils.ts`](src/cli/commands/utils.ts).

```text
src/cli/commands/
  utils.ts                      (modify — register new command)
  utils-symlink.ts              (new — parent command + dispatch)
  utils-symlink-agents.ts       (new — agents action)
  utils-symlink-skills.ts       (new — skills action)
  utils-symlink.test.ts         (new — memfs-backed tests)
```

The **pure logic** (decision tree: what state are we in, what operations to run) lives in small helpers that take a `FileSystem` + absolute base paths and return a list of planned operations. `planSkillsSymlink` is scope-agnostic — the CLI resolves `local` vs `global` into the two absolute directory paths before calling it, so the planner never has to care about home-dir expansion.

```ts
type SymlinkOp =
  | { kind: "rename"; from: string; to: string }
  | { kind: "symlink"; target: string; path: string }
  | { kind: "noop"; reason: string }
  | { kind: "conflict"; message: string };

function planAgentsSymlink(fs: FileSystem, cwd: string): Promise<SymlinkOp[]>;

interface SkillsTargets {
  claudeDir: string; // absolute, e.g. /repo/.claude/skills or ~/.claude/skills expanded
  agentsDir: string; // absolute, e.g. /repo/.agents/skills
  relativeTargetFromClaude: string; // e.g. "../.agents/skills"
}
function planSkillsSymlink(fs: FileSystem, t: SkillsTargets): Promise<SymlinkOp[]>;
```

The CLI action layer prints each op, runs it (skipping if `--dry-run`), and handles exit codes. This split lets tests assert on the plan without mocking the shell side.

### FileSystem extension

Extend [`src/utils/file-system.ts`](src/utils/file-system.ts) to add the methods needed for symlink workflows (not currently present):

```ts
interface FileSystem {
  // existing...
  symlink(target: string, path: string): Promise<void>;
  readlink(path: string): Promise<string>;
  lstat(path: string): Promise<Stats>;    // to detect symlinks without following
  rename(oldPath: string, newPath: string): Promise<void>;
}
```

The pattern is already used inside ralph at [`packages/ralph/src/build/loop.ts:406-418`](packages/ralph/src/build/loop.ts#L406-L418) but via an optional field — we make it mandatory on the interface since these commands require it. Audit call sites and update the shim in ralph if needed.

### Symlink direction

Symlinks point **from legacy → canonical**. Canonical is `AGENTS.md` / `.agents/skills`. Rationale: `.agents/` is the emerging cross-agent standard and already used by Goose. The symlink targets are **relative** so the tree can move.

- `CLAUDE.md -> AGENTS.md` (same directory, no prefix)
- `.claude/skills -> ../.agents/skills` (one level up then down)

### Edge cases

- **`CLAUDE.md` is a symlink pointing elsewhere** (e.g. to `docs/CLAUDE.md`): refuse, do not clobber the user's existing link.
- **`AGENTS.md` is a symlink** (e.g. in a monorepo pointing to a root AGENTS.md): keep it, create `CLAUDE.md -> AGENTS.md` symlink (resolves through the chain).
- **`.claude/skills` has uncommitted files** and `.agents/skills` already exists as a dir: conflict, no merge semantics in v1.
- **`.claude/` directory doesn't exist at all**: skip the skills command with a friendly message ("no .claude/skills found — nothing to do").
- **Permissions** (read-only FS, SIP, etc.): surface the OS error message directly.
- **Git index / staged renames**: out of scope. User is responsible for `git add` after the move.
- **Case-insensitive filesystems** (macOS default): `CLAUDE.md` and `claude.md` are the same file. Use exact case; on mismatch treat as "file exists."

### Config knobs

None in v1. No new fields in `poe-code.json`. The commands are one-shot utilities.

### Scope resolution for `skills`

Follows the same logic as [`skill configure`](src/cli/commands/skill.ts#L83-L103):

1. If `--local` → scope = `local`.
2. Else if `--global` → scope = `global`.
3. Else if `--yes` → scope = `global`.
4. Else prompt via design-system `select` with options `[Global, Local]`.
5. Error if both `--local` and `--global` are passed.

Local paths resolve relative to `--cwd` (default `process.cwd()`). Global paths resolve relative to `container.env.homeDir`. The relative symlink target is always `../.agents/skills` because `.claude/` and `.agents/` are siblings in both scopes.

### Resolved design decisions

- `skills` supports `--local` / `--global` with the same prompt/`--yes` pattern as `skill configure`. No behavioral divergence between scopes beyond the base directory.
- No Cursor / `.cursor/rules` / `.cursorrules` support. Cursor's shape (single file, not a directory) is different enough to warrant its own command later if needed.
- No modifications to `.gitignore`. Users decide whether `.agents/` is checked in.

## 4. Interfaces and test plan

### Module boundaries

```ts
// src/cli/commands/utils-symlink-agents.ts
export function registerUtilsSymlinkAgentsCommand(
  parent: Command,
  container: CliContainer
): void;

export async function planAgentsSymlink(
  fs: FileSystem,
  cwd: string
): Promise<SymlinkOp[]>;

// src/cli/commands/utils-symlink-skills.ts
export function registerUtilsSymlinkSkillsCommand(
  parent: Command,
  container: CliContainer
): void;

export interface SkillsTargets {
  claudeDir: string;
  agentsDir: string;
  relativeTargetFromClaude: string;
}

export function resolveSkillsTargets(
  scope: "local" | "global",
  env: { cwd: string; homeDir: string }
): SkillsTargets;

export async function planSkillsSymlink(
  fs: FileSystem,
  targets: SkillsTargets
): Promise<SymlinkOp[]>;

// src/cli/commands/utils-symlink.ts
export function registerUtilsSymlinkCommand(
  parent: Command,
  container: CliContainer
): void;

// shared
export type SymlinkOp =
  | { kind: "rename"; from: string; to: string }
  | { kind: "symlink"; target: string; path: string }
  | { kind: "noop"; reason: string }
  | { kind: "conflict"; message: string };

export async function applySymlinkOps(
  fs: FileSystem,
  ops: SymlinkOp[],
  opts: { dryRun: boolean; log: (msg: string) => void }
): Promise<{ conflicts: number }>;
```

### Test strategy

All tests use `memfs` per the CLAUDE.md unit-testing rules. Vitest suite `utils-symlink.test.ts` with table-driven cases:

**`planAgentsSymlink` cases:**

1. Only `CLAUDE.md` exists → `[rename, symlink]`.
2. Only `AGENTS.md` exists → `[symlink]`.
3. Neither exists → `[noop "no CLAUDE.md or AGENTS.md"]`.
4. Both exist as regular files → `[conflict]`.
5. `CLAUDE.md` already a symlink to `AGENTS.md` → `[noop "already linked"]`.
6. `CLAUDE.md` is a symlink pointing to something else → `[conflict]`.
7. `AGENTS.md` is a symlink, `CLAUDE.md` missing → `[symlink]`.

**`planSkillsSymlink` cases** (run once with local targets and once with global targets — parametrize the suite):

1. Only claude-dir exists (regular dir) → `[rename, symlink]`.
2. Only agents-dir exists → `[symlink]`.
3. Neither exists → `[noop]`.
4. Both exist → `[conflict]`.
5. claude-dir already symlinked to `../.agents/skills` → `[noop]`.
6. claude-dir symlinked elsewhere → `[conflict]`.

**`resolveSkillsTargets` cases:**

- `local` + `cwd=/repo` → `claudeDir=/repo/.claude/skills`, `agentsDir=/repo/.agents/skills`.
- `global` + `homeDir=/home/u` → `claudeDir=/home/u/.claude/skills`, `agentsDir=/home/u/.agents/skills`.
- Both return `relativeTargetFromClaude = "../.agents/skills"`.

**CLI scope handling** (tested via the command action with a mocked `select`):

- `--local --global` → error exit.
- `--local` → calls planner with local targets.
- `--global` → calls planner with global targets.
- `--yes` (no scope flag) → defaults to global.
- Neither flag, non-tty → prompt; stub `select` to return `global`, assert planner called with global targets.

**`applySymlinkOps` cases:**

- dry-run: asserts fs is untouched, log captures each planned op.
- real run: asserts fs ends in the expected state for each op kind.
- conflict op: asserts `conflicts` counter increments, no mutation.

**Integration (spot test, manual):**

- `npm run dev -- utils symlink agents` in a scratch dir with only `CLAUDE.md` → verify shell sees a symlink via `ls -la`.
- Same for `skills`.
- `npm run dev -- utils symlink agents --dry-run` → verify no writes.

No e2e test added — the scope is too small to justify it.

### Autonomy checklist

**Acceptance criteria** (each checkable from the working tree):

- [ ] `poe-code utils symlink --help` lists `agents` and `skills` subcommands.
- [ ] `planAgentsSymlink` and `planSkillsSymlink` return the expected op lists for each case in the table above.
- [ ] `applySymlinkOps` honors `--dry-run` (no fs mutation) and prints each op.
- [ ] Exit code `0` on success/no-op, `1` on conflict, `2` on win32.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test` all pass.

**Verification commands:**

- `npm run test -- utils-symlink` — runs the new unit tests.
- `npm run dev -- utils symlink --help` — confirms command is wired.
- `npm run dev -- utils symlink agents --dry-run --cwd /tmp/scratch` — end-to-end dry run.
- `npm run lint && npm run typecheck` — static checks.

**Fixtures / environment:** none. memfs covers everything.

**Decisions already made** (agent has authority):

- Canonical file is `AGENTS.md` / `.agents/skills`.
- Symlinks are relative, not absolute.
- Exit codes 0/1/2 as listed.
- `skills` has `--local` / `--global` / `--yes` using the same precedence and prompt as `skill configure`. Default scope (when `--yes`) is global.
- `agents` has no scope flag (AGENTS.md / CLAUDE.md are project-root only).
- No Cursor support. No `.gitignore` modifications.
- Error on win32; do not silently skip.

**Decisions the agent should escalate:**

- Any change to public config schema (none is expected — if one is needed, stop).
- Any change to how other agent providers resolve skill paths (`packages/agent-skill-config`).
- Adding dependencies outside of dev deps.

**Stop conditions:**

- `FileSystem` interface changes break unrelated call sites that can't be trivially fixed.
- Tests reveal the symlink direction is wrong for an agent we care about (e.g. Codex refuses to follow symlinks in `.claude/skills`).
- User conflict cases turn out to need merge semantics we haven't specified.

### Rollout / migration

- New commands, no existing callers. No migration required.
- Document in main README under `utils` section only after user approval (CLAUDE.md rule: do not touch README without permission).
- No release gating needed — ships on the next normal beta push.

## 5. Code plan

### Files to create

1. [`src/cli/commands/utils-symlink.ts`](src/cli/commands/utils-symlink.ts) — parent `symlink` command registration; delegates to the two action commands. Exports `registerUtilsSymlinkCommand`.

2. [`src/cli/commands/utils-symlink-agents.ts`](src/cli/commands/utils-symlink-agents.ts) — pure `planAgentsSymlink(fs, cwd)` + `registerUtilsSymlinkAgentsCommand(parent, container)`.

3. [`src/cli/commands/utils-symlink-skills.ts`](src/cli/commands/utils-symlink-skills.ts) — pure `planSkillsSymlink(fs, targets)` + `resolveSkillsTargets(scope, env)` + `registerUtilsSymlinkSkillsCommand(parent, container)`. The command action resolves scope (via flags / `--yes` / `select` prompt) mirroring [src/cli/commands/skill.ts:83-103](src/cli/commands/skill.ts#L83-L103), then calls the planner.

4. [`src/cli/commands/utils-symlink-ops.ts`](src/cli/commands/utils-symlink-ops.ts) — shared `SymlinkOp` type, `applySymlinkOps(fs, ops, { dryRun, log })`, and the "is this a symlink pointing at X" helper.

5. [`src/cli/commands/utils-symlink.test.ts`](src/cli/commands/utils-symlink.test.ts) — memfs-backed vitest suite covering the cases in §4.

### Files to change

1. [`src/cli/commands/utils.ts`](src/cli/commands/utils.ts) — import and call `registerUtilsSymlinkCommand(utils, container)` alongside the existing `registerConfigCommand` call.

2. [`src/utils/file-system.ts`](src/utils/file-system.ts) — add `symlink`, `readlink`, `lstat`, `rename` to the `FileSystem` interface. Update the default node-backed implementation (find via `grep` for `FileSystem` implementers).

3. [`packages/ralph/src/build/loop.ts`](packages/ralph/src/build/loop.ts) — if it currently uses an optional `fs.symlink ?? fallback` at lines 406-418, simplify now that `symlink` is required.

### Function signatures

```ts
// utils-symlink-ops.ts
export type SymlinkOp =
  | { kind: "rename"; from: string; to: string }
  | { kind: "symlink"; target: string; path: string }
  | { kind: "noop"; reason: string }
  | { kind: "conflict"; message: string };

export async function applySymlinkOps(
  fs: FileSystem,
  ops: SymlinkOp[],
  opts: { dryRun: boolean; log: (msg: string) => void }
): Promise<{ conflicts: number }>;

export async function isSymlinkPointingTo(
  fs: FileSystem,
  path: string,
  expectedTarget: string
): Promise<boolean>;

// utils-symlink-agents.ts
export async function planAgentsSymlink(
  fs: FileSystem,
  cwd: string
): Promise<SymlinkOp[]>;

export function registerUtilsSymlinkAgentsCommand(
  parent: Command,
  container: CliContainer
): void;

// utils-symlink-skills.ts
export interface SkillsTargets {
  claudeDir: string;
  agentsDir: string;
  relativeTargetFromClaude: string;
}

export function resolveSkillsTargets(
  scope: "local" | "global",
  env: { cwd: string; homeDir: string }
): SkillsTargets;

export async function planSkillsSymlink(
  fs: FileSystem,
  targets: SkillsTargets
): Promise<SymlinkOp[]>;

export function registerUtilsSymlinkSkillsCommand(
  parent: Command,
  container: CliContainer
): void;

// utils-symlink.ts
export function registerUtilsSymlinkCommand(
  parent: Command,
  container: CliContainer
): void;
```

### Build order

Build bottom-up so each step lands green:

1. **Extend `FileSystem`** and fix up implementers + ralph's shim. Run `npm run typecheck`.
2. **Implement and test `planAgentsSymlink` + `applySymlinkOps`** with memfs. TDD — write each case as a failing test first.
3. **Implement and test `planSkillsSymlink`** using the same ops helper.
4. **Wire the CLI commands** in `utils-symlink-agents.ts`, `utils-symlink-skills.ts`, `utils-symlink.ts`.
5. **Register** in `utils.ts`. Run `npm run dev -- utils symlink --help` to confirm wiring.
6. **Spot-test** both subcommands in a scratch directory with `npm run dev`.
7. **Screenshot** the help output per CLAUDE.md's visual-testing rule: `npm run screenshot-poe-code -- utils symlink --help`.
