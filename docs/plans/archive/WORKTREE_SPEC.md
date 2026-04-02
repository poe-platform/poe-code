# Worktree Parallelism Spec

## Problem

Running one agent at a time is slow. Independent tasks (stories, ad-hoc prompts, separate plans) can run in parallel — but they need isolated working directories to avoid stepping on each other's files. Git worktrees provide this: multiple checkouts sharing one `.git`, each on its own branch.

The hard part isn't parallelism — it's **merging back**. When two agents edit overlapping files, rebasing produces conflicts. We solve this with a dedicated **conflict resolution agent** that runs in the main worktree.

## Architecture

```
poe-code
├── @poe-code/worktree          # infrastructure package
│   ├── create / remove / list
│   ├── rebase (with conflict detection)
│   └── registry
├── poe-code worktree            # user-facing management commands
└── poe-code spawn --worktree    # isolated agent execution
```

## Worktree Lifecycle

```
create ──► agent works ──► merge back ──► cleanup
                               │
                          ┌────┴────┐
                          │         │
                        Clean    Conflict
                          │         │
                        Done    Conflict Resolution Agent
                                    │
                               ┌────┴────┐
                               │         │
                            Resolved   Failed
                               │         │
                             Done    Flag for manual review
```

## 1. `@poe-code/worktree` Package

### Worktree CRUD

```typescript
type Worktree = {
  name: string;
  path: string;
  branch: string;
  baseBranch: string;
  createdAt: string;
  source: "spawn";
  agent: string;
  status: "running" | "done" | "failed" | "conflict" | "merged";
  storyId?: string;
  planPath?: string;
  prompt?: string;         // truncated
};

// Create a worktree: git worktree add + branch + registry
createWorktree(opts: {
  name: string;
  baseBranch?: string;  // default: current HEAD
  cwd: string;
  source: Worktree["source"];
  agent: string;
  metadata?: Partial<Worktree>;
}): Promise<Worktree>

// Remove worktree: git worktree remove + delete branch + registry
removeWorktree(opts: {
  name: string;
  cwd: string;
  deleteBranch?: boolean;  // default: true
}): Promise<void>

// List all tracked worktrees, reconciled with git worktree list
listWorktrees(cwd: string): Promise<Worktree[]>

// Update status in registry
updateWorktreeStatus(cwd: string, name: string, status: Worktree["status"]): Promise<void>
```

### Directory Layout

```
.poe-code-worktrees/
  registry.json              # tracks all worktrees
  payments/                  # git worktree checkout
  auth-plan/                 # git worktree checkout
  fix-flaky-test/            # git worktree checkout
```

### Branch Naming

```
poe-code/<worktree-name>
```

Example: `poe-code/payments`, `poe-code/auth-plan`

### Registry

```jsonc
// .poe-code-worktrees/registry.json
{
  "worktrees": [
    {
      "name": "payments",
      "path": ".poe-code-worktrees/payments",
      "branch": "poe-code/payments",
      "baseBranch": "main",
      "createdAt": "2026-02-03T10:00:00Z",
      "source": "spawn",
      "agent": "claude-code",
      "status": "running",
      "prompt": "implement payment processing..."
    }
  ]
}
```

Registry is the source of truth for poe-code's view. `git worktree list` is used to reconcile (detect orphaned worktrees, etc).

## 2. Merge & Conflict Resolution

### Rebase Flow

When a worktree is ready to merge (agent finished successfully):

```
1. git rebase <baseBranch> onto worktree branch
2. If clean → fast-forward baseBranch → done
3. If conflict → invoke conflict resolution agent
```

### Conflict Resolution Agent

When rebase produces conflicts, a **dedicated agent** spawns in the **main worktree** to resolve them. This is a separate, focused agent invocation — not the original agent continuing its work.

#### Why a separate agent?

- The original agent's context is gone (fresh context per iteration)
- Conflict resolution is a different task than feature implementation
- Running in the main worktree gives access to the full, up-to-date codebase
- Keeps the concern isolated and testable

#### Agent Input

The conflict resolution agent receives a prompt containing:

```markdown
## Task

Resolve the git merge conflicts from rebasing branch `poe-code/<name>` onto `<baseBranch>`.

## Context

### Story / Task
<story description, acceptance criteria, or original spawn prompt>

### Commits on this branch
<git log of the story branch — what the agent did>

### Commits on base since branch point
<git log of base branch since divergence — what changed underneath>

### Conflicted Files
<list of files with conflicts>

### Conflict Details
<for each conflicted file: the full file with conflict markers>

## Instructions

- Resolve all conflicts preserving the intent of BOTH sides
- The story branch changes implement: <brief summary>
- The base branch changes implement: <brief summary>
- Run the project's quality gates after resolving: <quality gates from plan if available>
- Do NOT drop changes from either side unless they are truly redundant
- After resolving, stage the files and continue the rebase: git add <files> && git rebase --continue
```

#### Agent Selection

The conflict resolution agent is configurable:

```bash
poe-code worktree merge --conflict-agent claude-code  # explicit
```

Default: same agent that was used for the worktree.

#### Resolution Outcomes

```
Resolution succeeded (exit 0 + no remaining conflicts)
  → Complete rebase
  → Fast-forward base branch
  → Mark worktree as "merged"

Resolution failed (exit != 0 or conflicts remain)
  → Abort rebase (git rebase --abort)
  → Mark worktree as "conflict"
  → Log details to .poe-code-worktrees/<name>/conflict.log
  → User resolves manually
```

#### Retry Policy

- **One attempt** by default. Conflict resolution is deterministic enough that retrying with the same context rarely helps.
- `--conflict-retries <n>` flag available for experimentation.
- On retry, the previous attempt's error output is appended to the prompt as additional context.

### Merge Ordering (for swarm)

When multiple worktrees finish around the same time, merges happen **sequentially** with a lock:

```
1. Worktree A finishes → acquires merge lock → rebase → release
2. Worktree B finishes → acquires merge lock → rebase onto updated base → release
3. Worktree C finishes → acquires merge lock → rebase onto updated base → release
```

Later merges rebase onto a base that includes earlier merges. This means:
- Merge order affects conflict likelihood
- Worktrees that finish first get merged first (FIFO)
- If A conflicts and fails, B still merges cleanly against original base

## 3. CLI Commands

### `poe-code worktree list`

Show active worktrees and their status.

```
$ poe-code worktree list

  Name              Branch                    Agent         Status    Source
  payments          poe-code/payments         claude-code   running   spawn
  fix-flaky-test    poe-code/fix-flaky-test   claude-code   conflict  spawn
```

### `poe-code worktree merge [name]`

Rebase a completed worktree branch onto the current branch.

```bash
poe-code worktree merge payments              # merge specific worktree
poe-code worktree merge --all                 # merge all with status "done"
poe-code worktree merge --conflict-agent codex  # use specific agent for conflicts
```

Fails if worktree status is not "done". Use `--force` to attempt merge of "failed" worktrees.

### `poe-code worktree cleanup [name]`

Remove worktree directory, delete branch, remove from registry.

```bash
poe-code worktree cleanup payments
poe-code worktree cleanup --all               # cleanup all merged/failed
poe-code worktree cleanup --all --force       # cleanup everything including running
```

### `poe-code spawn --worktree`

```bash
poe-code spawn claude-code "implement payments" --worktree
poe-code spawn claude-code "fix tests" --worktree --name fix-tests
poe-code spawn claude-code "refactor auth" --worktree --auto-merge
```

Flags:
- `--worktree` — run in an isolated git worktree
- `--name <name>` — worktree name (default: derived from prompt)
- `--auto-merge` — rebase onto base branch on success (with conflict resolution)

## 4. SDK Parity

All worktree operations are exposed programmatically:

```typescript
import { createWorktree, listWorktrees, mergeWorktree, removeWorktree } from "@poe-code/worktree";

// Create
const wt = await createWorktree({ name: "my-task", cwd: process.cwd(), source: "spawn", agent: "claude-code" });

// List
const all = await listWorktrees(process.cwd());

// Merge with conflict resolution
const result = await mergeWorktree({
  name: "my-task",
  cwd: process.cwd(),
  conflictAgent: "claude-code",   // optional
  conflictRetries: 1              // optional
});
// result.status: "merged" | "conflict" | "already-merged"

// Cleanup
await removeWorktree({ name: "my-task", cwd: process.cwd() });
```

`spawn` accepts an optional `worktree` option:

```typescript
import { spawn } from "poe-code";

await spawn("claude-code", {
  prompt: "implement payments",
  worktree: { enabled: true, name: "payments", autoMerge: true }
});
```

## 5. Implementation Order

1. **`@poe-code/worktree`** — git worktree CRUD, registry, rebase with conflict detection
2. **`poe-code worktree` commands** — list, merge, cleanup
3. **Conflict resolution agent** — prompt template, spawn-in-main-worktree flow
4. **`poe-code spawn --worktree`** — wire worktree into spawn

## 6. Edge Cases

### Worktree left behind after crash
`poe-code worktree list` reconciles the registry with `git worktree list`. Orphaned worktrees (in git but not in registry, or vice versa) are flagged and can be cleaned up.

### Agent installs dependencies
The agent will see a fresh checkout without `node_modules`. Agents already handle this — they read `package.json` and install deps as part of their task. No special setup step needed.

### Worktree on detached HEAD
Always create worktrees on named branches (`poe-code/<name>`). Never detached HEAD.

### Multiple swarms on same plan
The lock on the plan file prevents double-assignment of stories. Two swarms on the same plan would coordinate via the lock — each grabs different stories.

### Base branch moves during work
Worktrees are branched from a point-in-time snapshot. The rebase at merge time handles catching up. If the base has diverged significantly, conflicts are more likely — but that's what the conflict resolution agent is for.
