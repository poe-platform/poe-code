# Chore Command Plan

## Overview

Add a `poe-code chore <name>` command that runs predefined, prompt-driven maintenance tasks through a configured agent. The system follows a pipeline architecture: **prompt library → source → map(agent executor)**.

Key motivator: automate fixes for dependabot/security vulnerabilities surfaced on `git push`.

## Design Principle

- Chores are declarative: one `.md` prompt file per chore, everything else derived
- Pipeline: source command discovers items, each item spawns its own agent
- Reuse spawn/agent infrastructure for execution (agent, model, interactive flags)
- No branching logic per chore type in core code — chores are discovered automatically
- GitHub-native state management — no local state files
- SDK parity with CLI

## Architecture

```
┌─────────────┐    ┌──────────┐    ┌──────────────┐
│ Prompt       │    │ Source   │    │ Agent        │
│ Library      │───▶│ Command  │───▶│ Executor     │
│ (discovery)  │    │ (JSON[]) │    │ (per item)   │
└─────────────┘    └──────────┘    └──────────────┘
packages/chores/   sh -c "source"   src/sdk/chore.ts
```

**Two chore modes:**

- **Simple** (no `source`): single agent spawn with the full prompt body
- **Sourced** (with `source`): shell command returns JSON array, each item spawns its own agent with a mustache-rendered prompt

## Command Usage

### `poe-code chore <name>`

```bash
poe-code chore fix-vulnerabilities
poe-code chore update-dependencies
poe-code chore github-issue-check
```

### Standard Agent Options

All chores accept the same agent params as spawn:

```bash
poe-code chore fix-vulnerabilities --agent claude --model Claude-Sonnet-4.5
poe-code chore fix-vulnerabilities -i              # interactive mode
poe-code chore fix-vulnerabilities --yes           # accept defaults
```

### `poe-code chore list`

Lists all available chores in a table (built-in + project-local).

### `poe-code chore enable <name>`

Enables a chore by creating its GitHub Actions workflow file:

```bash
poe-code chore enable fix-vulnerabilities          # creates .github/workflows/chore-fix-vulnerabilities.yml
poe-code chore enable fix-vulnerabilities --copy   # also copies prompt to .poe-code/chores/ for customization
```

**Flow:**

1. Loads chore definition (built-in or project-local)
2. Generates `.github/workflows/chore-<name>.yml` with cron from `schedule` frontmatter
3. If `--copy`: also copies the `.md` prompt file into `<cwd>/.poe-code/chores/`

### `poe-code chore disable <name>`

Disables a chore by deleting its workflow file:

```bash
poe-code chore disable fix-vulnerabilities   # deletes .github/workflows/chore-fix-vulnerabilities.yml
```

## Chore Prompt Format

Each chore is a markdown file with YAML frontmatter:

```markdown
---
name: fix-vulnerabilities
description: Fix dependabot security vulnerabilities
source: gh api repos/{owner}/{repo}/dependabot/alerts --jq '[.[] | select(.state=="open")]'
schedule: '0 6 * * 1'
---

# Fix: {{dependency.package.name}}

Severity: {{security_advisory.severity}}
Summary: {{security_advisory.summary}}

1. Update {{dependency.package.name}} to the patched version
2. Run tests to verify nothing breaks
3. Commit with: fix(deps): upgrade {{dependency.package.name}}
```

### Frontmatter fields

- `name` (required): chore identifier
- `description` (required): human-readable summary
- `source` (optional): shell command whose stdout is parsed as JSON array
- `schedule` (optional): cron expression for GitHub Action generation
- Prompt body: mustache template rendered per source item (or used as-is for simple chores)

## Built-in Chores

### `update-dependencies`

Simple chore. Updates project dependencies to latest versions.

### `update-documentation`

Simple chore. Reviews code changes since last documentation update and refreshes docs.

### `github-issue-check`

Sourced chore. Source: `gh issue list` filtered to exclude `poe-triaged` label.
Agent triages each issue and adds `poe-triaged` label when done.

### `github-pull-request-check`

Sourced chore. Source: `gh pr list` filtered to unreviewed PRs.
Agent reviews each PR and posts review comments.

### `fix-vulnerabilities`

Sourced chore. Source: `gh api` dependabot alerts filtered to open.
Agent fixes each vulnerability — update dep, run tests, commit.

## State Management

GitHub-native — no local state files. Each chore uses platform state:

- **Issues**: agent adds `poe-triaged` label → source filters `select(... | index("poe-triaged") | not)`
- **PRs**: agent posts review → source filters unreviewed PRs
- **Vulnerabilities**: fix auto-closes the alert → source only returns open alerts

## Chore Discovery

Priority order (later overrides by name):

1. **Built-in**: `packages/chores/src/prompts/*.md` — ships with poe-code
2. **Project-local**: `<cwd>/.poe-code/chores/*.md` — copied via `chore enable --copy` or user-created

```
packages/chores/
  src/
    prompts/
      update-dependencies.md
      update-documentation.md
      github-issue-check.md
      github-pull-request-check.md
      fix-vulnerabilities.md
    index.ts                  # exports chore registry
    discover.ts               # reads prompts dir, parses frontmatter, merges layers
    frontmatter.ts            # YAML frontmatter parser
    types.ts                  # ChoreDefinition type
```

### Chore Registry

```typescript
interface ChoreDefinition {
  name: string;
  description: string;
  prompt: string;             // full markdown body (mustache template)
  source?: string;            // shell command returning JSON array
  schedule?: string;          // cron expression
}

function discoverChores(builtInDir, projectDir?): Promise<ChoreDefinition[]>
function loadChore(name, dirs): Promise<ChoreDefinition>
```

Frontmatter parsed with a simple custom parser (no `gray-matter` dependency — promoted from existing test code in `agent-skill-config`).

## Execution Flow

### Simple chore (no source)

1. Discover chore, match by name
2. Resolve agent + model
3. Spawn agent with raw prompt body

### Sourced chore

1. Discover chore, match by name
2. Resolve agent + model
3. Run source command: `commandRunner("sh", ["-c", source])`
4. Parse stdout as JSON array
5. For each item: `mustache.render(template, item)` → spawn agent
6. Collect results

```typescript
// Pseudocode for src/sdk/chore.ts
async function runChore(container, options) {
  const definition = await loadChore(options.name, {
    builtIn: promptsDirUrl,
    projectLocal: path.join(container.env.cwd, ".poe-code/chores")
  });

  if (!definition.source) {
    return spawnSdk(options.agent, { prompt: definition.prompt });
  }

  const { stdout } = await commandRunner("sh", ["-c", definition.source]);
  const items = JSON.parse(stdout);

  const results = [];
  for (const item of items) {
    const prompt = mustache.render(definition.prompt, item);
    const { result } = spawnSdk(options.agent, { prompt });
    results.push(await result);
  }
  return results;
}
```

## Workflow Generation (`chore enable`)

Each `chore enable <name>` creates a dedicated workflow file at `.github/workflows/chore-<name>.yml`:

```yaml
# Auto-generated by poe-code chore enable fix-vulnerabilities
name: 'Chore: fix-vulnerabilities'
on:
  schedule:
    - cron: '0 6 * * 1'    # from frontmatter schedule field
  workflow_dispatch:

jobs:
  run:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      security-events: read
    steps:
      - uses: actions/checkout@v4
      - run: npx poe-code chore fix-vulnerabilities --yes --agent claude
        env:
          POE_API_KEY: ${{ secrets.POE_API_KEY }}
```

One workflow file per chore. The `schedule` frontmatter field drives the cron expression. `chore disable <name>` deletes the corresponding workflow file.

If `--copy` is passed with `chore enable`, the `.md` prompt is also copied to `.poe-code/chores/` for customization.

## SDK Integration

```typescript
// src/sdk/chore.ts
export interface ChoreOptions {
  name: string;
  agent: string;
  model?: string;
  mode?: SpawnMode;
  cwd?: string;
}

export async function runChore(
  container: CliContainer,
  options: ChoreOptions
): Promise<{ results: SpawnResult[] }>
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/chores/package.json` | New package `@poe-code/chores` |
| `packages/chores/tsconfig.json` | Extends root |
| `packages/chores/src/types.ts` | ChoreDefinition type |
| `packages/chores/src/frontmatter.ts` | YAML frontmatter parser |
| `packages/chores/src/frontmatter.test.ts` | Frontmatter unit tests |
| `packages/chores/src/discover.ts` | Discovery + merge layers |
| `packages/chores/src/discover.test.ts` | Discovery tests |
| `packages/chores/src/index.ts` | Public exports |
| `packages/chores/src/prompts/*.md` | 5 built-in chore prompts |
| `packages/chores/src/prompts/prompts.test.ts` | Validate all prompts |
| `src/sdk/chore.ts` | SDK executor (source → map → spawn) |
| `src/cli/commands/chore.ts` | CLI command (run, list, enable, disable) |
| `src/cli/commands/chore.test.ts` | CLI tests |
| `src/cli/program.ts` | Register `registerChoreCommand()` |
| `src/index.ts` | Export SDK `runChore()` |

## Implementation Steps

1. Create `packages/chores` package with frontmatter parser (TDD)
2. Add types and discovery with two-layer merge (TDD)
3. Write 5 built-in chore prompt files + validation tests
4. Implement SDK executor with source → map → spawn pipeline
5. Implement CLI `chore` command (run + list + enable + disable subcommands)
6. Register command in `program.ts`, export from SDK
7. Screenshots + E2E tests

## Testing Strategy

- **Frontmatter**: pure function tests, no mocking
- **Discovery**: mock `node:fs/promises` via `vi.mock`
- **Executor**: mock `spawnSdk` and `commandRunner` at boundary
- **CLI**: mock `@poe-code/chores` and `../../sdk/spawn.js`
- **Prompts**: validate all built-in prompts have valid frontmatter
- **Visual**: `bun run screenshot-poe-code -- chore --help`, `chore list`, `chore enable --help`
- **No LLM calls in tests**
