---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Spawn Independent Skills

Temporarily stage selected independent skills for external coding-agent spawns.

## 1. What we're building

Add a per-run way to pass independent skills to external coding agents: Codex, Claude Code, and OpenCode.

The user wants a workaround that lets `poe-code spawn` expose selected skills to the spawned agent without permanently installing them into each agent's skill directory. The current candidate is a per-run filesystem overlay: create the agent-specific local skill directory under the spawn cwd, symlink selected independent skill folders into it, run the agent, then clean up only symlinks and empty parent directories created by that run.

The feature should use the existing declarative agent skill config:

- Codex local skills: `.codex/skills`
- Claude Code local skills: `.claude/skills`
- OpenCode local skills: `.opencode/skills`

The implementation should not branch by provider. It should derive the target local skill directory from `@poe-code/agent-skill-config` and keep provider-specific knowledge in provider config.

Parallel execution can accept temporary skill union visibility for the same agent and same cwd. If two overlapping runs stage different skills into the same local skill directory, either run may see all currently staged skills. Cleanup must still be conservative and must never delete user-owned files or directories.

Explicit non-goals:

- Do not focus on `poe-agent` in-process skills.
- Do not permanently install skills globally.
- Do not copy every available skill for every run.
- Do not add provider-specific `if`/`case` branching.
- Do not delete existing `.codex`, `.claude`, `.opencode`, or user-created skill directories.

## 2. User-facing shape

## 3. Implementation details and technical decisions

### Hiding staged paths from git

Staged symlinks under `.codex/skills/…`, `.claude/skills/…`, `.opencode/skills/…` are untracked and would otherwise show in `git status` and be vulnerable to a blanket `git add`. Append per-run blocks to `.git/info/exclude` (repo-local, never committed) — not the project `.gitignore` and not the user's global excludes file.

- Resolve the exclude file via `git rev-parse --git-dir` so worktrees and submodules work; if cwd is not inside a git repo, skip the exclude step silently.
- Frame each run's entries with markers so cleanup is precise:

  ```text
  # poe-code-spawn-skills:<runId> begin
  .codex/skills/skill-a
  .claude/skills/skill-b
  # poe-code-spawn-skills:<runId> end
  ```

- Cleanup removes only the block between this run's markers; other runs' blocks and pre-existing user entries are left intact.
- Exclude-file edits and symlink ops share the same cleanup contract: best-effort, idempotent, never touch user-owned content.

## 4. Interfaces and test plan

## 5. Code plan
