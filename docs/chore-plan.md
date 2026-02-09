# Chore Command Plan

## Overview

Add a `poe-code chore <name>` command that runs predefined, prompt-driven maintenance tasks through a configured agent. Each chore is a self-contained markdown prompt file executed via the existing spawn infrastructure.

## Design Principle

- Chores are declarative: one `.md` prompt file per chore, everything else derived
- Reuse spawn/agent infrastructure for execution (agent, model, interactive flags)
- No branching logic per chore type in core code — chores are discovered automatically
- SDK parity with CLI

## Command Usage

### `poe-code chore <name>`

```bash
poe-code chore update-dependencies
poe-code chore update-documentation
poe-code chore github-issue-check
poe-code chore github-pull-request-check
```

### Standard Agent Options

All chores accept the same agent params as spawn:

```bash
poe-code chore update-dependencies --agent claude --model Claude-Sonnet-4.5
poe-code chore update-dependencies -i              # interactive mode
poe-code chore update-dependencies --yes            # accept defaults
```

### `poe-code chore --help`

Lists available chores with descriptions (extracted from prompt frontmatter).

### `poe-code chore list`

Lists all available chores in a table.

## Chore Prompt Format

Each chore is a markdown file with YAML frontmatter:

```markdown
---
name: update-dependencies
description: Update project dependencies to latest versions
---

# Update Dependencies

You are a maintenance agent. Your task is to update all project dependencies.

1. Check for outdated dependencies
2. Update them one at a time
3. Run tests after each update
4. Commit each successful update
```

## Built-in Chores

### `update-dependencies`

Updates project dependencies to latest versions.

### `update-documentation`

Reviews code changes since last documentation update and refreshes docs.

### `github-issue-check`

Triages open GitHub issues:
- Tracks already-checked issues (local state file `.poe-code/chore-state/github-issue-check.json`)
- Assesses severity and alerts issue creator
- Optionally proposes resolutions
- Uses `gh` CLI for GitHub API access

### `github-pull-request-check`

Reviews open pull requests:
- Tracks already-reviewed PRs (local state file `.poe-code/chore-state/github-pull-request-check.json`)
- Performs code review
- Posts review comments via `gh` CLI

## State Management (GitHub Chores)

GitHub-related chores need to track what has already been processed to avoid re-checking. State is stored per-project:

```
.poe-code/chore-state/
  github-issue-check.json
  github-pull-request-check.json
```

```typescript
interface ChoreState {
  lastRun: string;           // ISO timestamp
  processedIds: number[];    // issue/PR numbers already checked
}
```

The prompt instructs the agent to read/write this state file. The chore infrastructure itself does not manage state — the agent does, guided by the prompt.

## Chore Discovery

Chores are discovered from a built-in directory:

```
packages/chores/
  prompts/
    update-dependencies.md
    update-documentation.md
    github-issue-check.md
    github-pull-request-check.md
  src/
    index.ts                  # exports chore registry
    discover.ts               # reads prompts dir, parses frontmatter
    types.ts                  # ChoreDefinition, ChoreState types
```

### Chore Registry

```typescript
interface ChoreDefinition {
  name: string;
  description: string;
  prompt: string;             // full markdown body
}

function discoverChores(): ChoreDefinition[]
```

Frontmatter is parsed with `gray-matter` (already common in the ecosystem).

## Implementation Architecture

### CLI Command

```typescript
// src/cli/commands/chore.ts
export function registerChoreCommand(
  program: Command,
  container: CliContainer
): void {
  const chore = program
    .command("chore")
    .description("Run maintenance chores via an agent")
    .argument("<name>", "Chore to run")
    .option("--agent <agent>", "Agent to use")
    .option("--model <model>", "Model override")
    .option("-i, --interactive", "Interactive mode")
    .action(async function (name, options) {
      // 1. Discover chores, find by name
      // 2. Resolve agent (prompt or --agent)
      // 3. Spawn agent with chore prompt
    });

  chore
    .command("list")
    .description("List available chores")
    .action(async () => {
      // List all discovered chores in a table
    });
}
```

### Execution Flow

1. Discover available chores from `packages/chores/prompts/`
2. Match requested chore by name
3. Resolve agent + model (same option resolution as spawn)
4. Spawn agent with the chore's prompt content as the prompt text
5. Agent executes autonomously guided by the prompt

## SDK Integration

```typescript
// sdk/chore.ts
export interface ChoreOptions {
  name: string;
  agent: string;
  model?: string;
}

export async function runChore(options: ChoreOptions): Promise<void>
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/chores/` | New package — prompts + discovery |
| `packages/chores/prompts/update-dependencies.md` | Prompt file |
| `packages/chores/prompts/update-documentation.md` | Prompt file |
| `packages/chores/prompts/github-issue-check.md` | Prompt file |
| `packages/chores/prompts/github-pull-request-check.md` | Prompt file |
| `packages/chores/src/index.ts` | Chore registry exports |
| `packages/chores/src/discover.ts` | Prompt discovery + frontmatter parsing |
| `packages/chores/src/types.ts` | Types |
| `src/cli/commands/chore.ts` | CLI command |
| `src/cli/program.ts` | Register `registerChoreCommand()` |
| `src/sdk/chore.ts` | SDK function |
| `tests/chore-command.test.ts` | Unit tests |
| `tests/chore-discover.test.ts` | Discovery tests |

## Implementation Steps

1. Create `packages/chores` package with types and discovery
2. Write the 4 built-in chore prompt files
3. Implement `chore` CLI command with agent/model/interactive options
4. Register command in `program.ts`
5. Add SDK `runChore()` function
6. Tests (memfs for discovery, snapshot for prompt parsing)

## Testing Strategy

- Discovery tests: use memfs to simulate prompt directory, verify frontmatter parsing
- CLI tests: verify option resolution, chore name matching, error on unknown chore
- No LLM calls in tests — mock spawn at the boundary
- Screenshot test: `npm run screenshot-poe-code -- chore --help` and `chore list`

## Open Questions

1. Should users be able to add custom chores from a project-local directory (e.g. `.poe-code/chores/`)?
2. Should `github-issue-check` state be committed to repo or gitignored?
3. Should chores support a `--dry-run` mode that shows the prompt without executing?
