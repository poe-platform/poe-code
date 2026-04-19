---
kind: pipeline
vars:
  plan_doc: "{{file \"docs/plans/utils-symlink-agents-and-skills.md\"}}"

tasks:
  - id: extend-filesystem
    title: Extend FileSystem interface with symlink methods
    prompt: |
      Design doc for the whole feature (read carefully, this task is step 1 of the build order in section 5):

      {{plan_doc}}

      Scope of THIS task only:

      Extend `src/utils/file-system.ts` so the `FileSystem` interface has these mandatory methods:

      ```ts
      symlink(target: string, path: string): Promise<void>;
      readlink(path: string): Promise<string>;
      lstat(path: string): Promise<Stats>;
      rename(oldPath: string, newPath: string): Promise<void>;
      ```

      Update the default node-backed implementation to implement them (delegate to `node:fs/promises`).

      Audit every `FileSystem` implementer in the repo (grep for `FileSystem` implements / type usage) and make each one satisfy the new interface — including the memfs-backed test helpers and the shim referenced near `packages/ralph/src/build/loop.ts:406-418`. If ralph used an optional `fs.symlink ?? fallback`, simplify it now that `symlink` is mandatory.

      Follow TDD only where it makes sense — the interface itself is not directly testable, but any behavior change in ralph's shim must be covered by a test.

      Verification: `npm run typecheck` passes with zero errors.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: ops-and-agents-planner
    title: Implement shared symlink ops and planAgentsSymlink
    prompt: |
      Design doc for the whole feature (full context, including the SymlinkOp types, edge cases, and case tables):

      {{plan_doc}}

      Scope of THIS task only:

      Create two new files:

      1. `src/cli/commands/utils-symlink-ops.ts` exporting:
         - `SymlinkOp` discriminated union (`rename | symlink | noop | conflict`) exactly as specified in the design doc section 4.
         - `applySymlinkOps(fs, ops, { dryRun, log })` returning `{ conflicts: number }`.
         - `isSymlinkPointingTo(fs, path, expectedTarget)` helper.

      2. `src/cli/commands/utils-symlink-agents.ts` exporting `planAgentsSymlink(fs, cwd)`. Do NOT register the CLI command yet — only the pure planner. Canonical is `AGENTS.md`, legacy is `CLAUDE.md`, symlink direction is `CLAUDE.md -> AGENTS.md` (relative, same directory).

      Create `src/cli/commands/utils-symlink.test.ts` using memfs (per CLAUDE.md: `Tests must not create files - use memfs`). Table-driven vitest suite covering every `planAgentsSymlink` case in section 4 (7 cases) plus `applySymlinkOps` cases (dry-run untouched fs, real run applies each op kind, conflict increments counter with no mutation).

      TDD is mandatory for this task per CLAUDE.md. Write failing tests first for each case, then implement.

      Verification: `npm run test -- utils-symlink` passes; `npm run typecheck` clean.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: skills-planner
    title: Implement planSkillsSymlink and resolveSkillsTargets
    prompt: |
      Design doc for the whole feature (read section 3 "Scope resolution for skills" and section 4 test cases for `planSkillsSymlink` / `resolveSkillsTargets` carefully):

      {{plan_doc}}

      Scope of THIS task only:

      Create `src/cli/commands/utils-symlink-skills.ts` exporting (CLI registration still comes later — only the pure functions here):

      - `SkillsTargets` interface: `{ claudeDir, agentsDir, relativeTargetFromClaude }`.
      - `resolveSkillsTargets(scope, env)` where `scope: "local" | "global"` and `env: { cwd, homeDir }`.
        - `local` + `cwd=/repo` → `claudeDir=/repo/.claude/skills`, `agentsDir=/repo/.agents/skills`.
        - `global` + `homeDir=/home/u` → `claudeDir=/home/u/.claude/skills`, `agentsDir=/home/u/.agents/skills`.
        - Both scopes → `relativeTargetFromClaude = "../.agents/skills"`.
      - `planSkillsSymlink(fs, targets)` using the `SymlinkOp` type and `isSymlinkPointingTo` helper from `utils-symlink-ops.ts`. Scope-agnostic: only takes the already-resolved absolute paths.

      Extend `src/cli/commands/utils-symlink.test.ts` with:
      - `resolveSkillsTargets` cases (local, global, relative target equality).
      - `planSkillsSymlink` cases — parametrize once with local targets and once with global targets, covering the 6 cases in section 4.

      TDD mandatory. All tests use memfs.

      Out of scope for this task: the CLI command registration (next task). Do not add `--local`/`--global` flag parsing, do not wire into commander.

      Verification: `npm run test -- utils-symlink` all green; `npm run typecheck` clean.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: wire-cli-commands
    title: Wire utils symlink parent and subcommands into CLI
    prompt: |
      Design doc for the whole feature (read section 2 for exact help text, section 3 for scope resolution precedence, section 5 for the file list):

      {{plan_doc}}

      Scope of THIS task only:

      Create:

      1. `src/cli/commands/utils-symlink.ts` exporting `registerUtilsSymlinkCommand(parent, container)` that registers the `symlink` parent command with the help text from section 2 and delegates to the two subcommand registrars.

      2. Add `registerUtilsSymlinkAgentsCommand(parent, container)` to `src/cli/commands/utils-symlink-agents.ts`. Flags: `--dry-run`, `--cwd <dir>`. Action calls `planAgentsSymlink` then `applySymlinkOps`, sets exit code: `0` success/no-op, `1` any conflict op, `2` on win32 or permission error.

      3. Add `registerUtilsSymlinkSkillsCommand(parent, container)` to `src/cli/commands/utils-symlink-skills.ts`. Flags: `--dry-run`, `--cwd <dir>`, `--local`, `--global`, `-y, --yes`. Scope precedence must mirror `src/cli/commands/skill.ts:83-103` exactly:
         1. `--local` → local; `--global` → global; both → error exit.
         2. Neither + `--yes` → global.
         3. Neither + interactive → design-system `select` prompt `[Global, Local]`. Do NOT use `@clack/prompts` or `chalk` directly (CLAUDE.md rule).

      Modify `src/cli/commands/utils.ts` to call `registerUtilsSymlinkCommand(utils, container)` alongside the existing `registerConfigCommand`.

      Extend the test suite with CLI-level scope-handling tests (mock `select`): `--local --global` errors, `--local` calls planner with local targets, `--global` calls planner with global targets, `--yes` defaults to global, non-tty with stubbed `select` returning `global` calls planner with global targets.

      Verification:
      - `npm run test -- utils-symlink` all green.
      - `npm run dev -- utils symlink --help` prints the help text from section 2.
      - `npm run typecheck` and `npm run lint` clean.
    status:
      implement: done
      refactor: done
      test: done
      commit: open

  - id: spot-test-and-screenshots
    title: Spot-test and screenshot the new commands
    prompt: |
      Design doc for the whole feature (full context for what the output should look like — section 2 has the exact expected terminal output):

      {{plan_doc}}

      Scope of THIS task only — end-to-end manual validation per CLAUDE.md visual/spot testing rules. No new production code unless a bug surfaces.

      Steps:

      1. Screenshot the help output (CLAUDE.md: "Test every change using screenshots that might have impact on visual cli"):
         - `npm run screenshot-poe-code -- utils symlink --help`
         - `npm run screenshot-poe-code -- utils symlink agents --help`
         - `npm run screenshot-poe-code -- utils symlink skills --help`
         Confirm they render through the design system (no raw chalk/clack).

      2. Spot-test `agents` in a scratch dir:
         - Create `/tmp/symlink-scratch` with only a `CLAUDE.md`.
         - `npm run dev -- utils symlink agents --cwd /tmp/symlink-scratch` → expect rename + symlink.
         - Run again → expect idempotent "already linked" no-op.
         - Recreate with both `CLAUDE.md` and `AGENTS.md` as regular files → expect conflict message, exit code 1.
         - `npm run dev -- utils symlink agents --cwd /tmp/symlink-scratch --dry-run` → expect no fs mutation.

      3. Spot-test `skills`:
         - Scratch dir with only `.claude/skills`. Run `npm run dev -- utils symlink skills --local --cwd <dir>` → expect move + relative symlink `.claude/skills -> ../.agents/skills`.
         - Run again → idempotent no-op.
         - Interactive scope prompt: `npm run dev -- utils symlink skills --cwd <dir>` → expect the design-system `select` with `[Global, Local]`.

      4. If any bug surfaces, fix it and add a regression test using memfs before moving on. Do not ship without the fix.

      5. Confirm `npm run test`, `npm run lint`, `npm run typecheck` are all green on the final tree.

      Out of scope: documentation changes to README (CLAUDE.md rule: do not touch README without user permission).
    status:
      implement: open
      refactor: open
      test: open
      commit: open
---

# Context

This pipeline plan drives the implementation of the design doc at [docs/plans/utils-symlink-agents-and-skills.md](docs/plans/utils-symlink-agents-and-skills.md).

## Why this task order

The design doc section 5 prescribes a bottom-up build order. The five tasks above follow it exactly:

1. **FileSystem extension** is foundational — nothing else compiles without it.
2. **Shared ops + agents planner** introduces the `SymlinkOp` vocabulary and the simpler of the two planners, so the skills planner can reuse the primitives.
3. **Skills planner** adds scope resolution on top of the already-proven ops layer.
4. **CLI wiring** pulls the planners behind commander subcommands and the scope prompt.
5. **Spot-test + screenshots** is a hard gate per CLAUDE.md — "Test every change using screenshots that might have impact on visual cli."

## Acceptance criteria (lifted from the design doc §4)

- `poe-code utils symlink --help` lists `agents` and `skills` subcommands.
- `planAgentsSymlink` and `planSkillsSymlink` return the op lists specified in §4 for every case in the table.
- `applySymlinkOps` honors `--dry-run` (no fs mutation) and prints each op.
- Exit codes: `0` success/no-op, `1` conflict, `2` win32/permission error.
- `npm run lint`, `npm run typecheck`, `npm run test` all pass.

## Guardrails from CLAUDE.md that matter here

- TDD is a must for code changes.
- Tests must use memfs, not real disk writes.
- Do not use `@clack/prompts` or `chalk` directly — go through the design system.
- Do not modify the README without user permission.
- Relevant plans belong to commits (the `commit` step should include this plan file if it was updated).
