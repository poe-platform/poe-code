# spawn-github Feature

## Overview

New command to clone a GitHub repository and spawn an agent in it.

```bash
poe-code spawn-github <url or owner/repo> "Prompt" [agentArgs...]
```

## Examples

```bash
# Using owner/repo format
poe-code spawn-github anthropics/claude-code "Review this codebase"

# Using full URL
poe-code spawn-github https://github.com/anthropics/claude-code "Find security issues"

# With --keep flag to preserve the cloned repo
poe-code spawn-github --keep anthropics/claude-code "Add tests"

# With service selection (default: claude-code)
poe-code spawn-github --service codex anthropics/claude-code "Fix bugs"
```

## CLI Options

| Option | Description |
|--------|-------------|
| `--keep` | Do not delete the cloned repository after completion |
| `--service <service>` | Service to use (default: `claude-code`) |
| `--model <model>` | Model identifier override |
| `--branch <branch>` | Checkout specific branch (default: default branch) |
| `--stdin` | Read prompt from stdin |

## SDK API

```typescript
import { spawnGithub } from 'poe-code';

const result = await spawnGithub('anthropics/claude-code', {
  prompt: 'Review this codebase',
  service: 'claude-code',  // optional, default: claude-code
  keep: false,             // optional, default: false
  branch: 'main',          // optional
  model: 'opus',           // optional
  agentArgs: [],           // optional
});

// result: { stdout, stderr, exitCode, repoPath }
```

## Deterministic Temp Directory

The temp directory is deterministic based on the repository identifier:

```
~/.poe-code/github-repos/<hash>/
```

Where `<hash>` is derived from:
- Normalized repository identifier (owner/repo lowercase)
- This allows `--keep` to work and lets users return to the same directory

Example:
- `anthropics/claude-code` → `~/.poe-code/github-repos/anthropics-claude-code/`

Using simple `owner-repo` format (no hashing) for readability and debuggability.

## Implementation Plan

### 1. Add GitHub URL parser utility

**File**: `src/utils/github-url.ts`

```typescript
interface ParsedGithubRepo {
  owner: string;
  repo: string;
  normalized: string;  // "owner/repo" lowercase
}

function parseGithubRepo(input: string): ParsedGithubRepo;
```

Accepts:
- `owner/repo`
- `https://github.com/owner/repo`
- `https://github.com/owner/repo.git`
- `git@github.com:owner/repo.git`

### 2. Add repo directory resolver

**File**: `src/utils/repo-dir.ts`

```typescript
function getRepoDir(normalized: string, homeDir: string): string;
// Returns: ~/.poe-code/github-repos/<owner>-<repo>/
```

### 3. Add git clone utility

**File**: `src/utils/git-clone.ts`

```typescript
interface CloneOptions {
  repoUrl: string;
  targetDir: string;
  branch?: string;
}

async function cloneRepo(
  runner: CommandRunner,
  options: CloneOptions
): Promise<void>;
```

- Checks if directory already exists (skip clone if so)
- If exists, do `git fetch && git checkout <branch>` instead
- Uses shallow clone (`--depth 1`) for speed

### 4. Create spawn-github core logic

**File**: `src/sdk/spawn-github-core.ts`

```typescript
interface SpawnGithubCoreOptions {
  repo: string;
  prompt: string;
  service?: string;
  keep?: boolean;
  branch?: string;
  model?: string;
  agentArgs?: string[];
  stdin?: boolean;
}

interface SpawnGithubResult extends SpawnResult {
  repoPath: string;
}

async function spawnGithubCore(
  container: Container,
  options: SpawnGithubCoreOptions,
  flags: CommandFlags
): Promise<SpawnGithubResult>;
```

Flow:
1. Parse GitHub repo from input
2. Compute deterministic directory path
3. Clone or update repository
4. Call existing `spawnCore` with `cwd` set to repo directory
5. Cleanup (delete directory) unless `--keep`
6. Return result with `repoPath`

### 5. Add SDK public API

**File**: `src/sdk/spawn-github.ts`

```typescript
export async function spawnGithub(
  repo: string,
  options: SpawnGithubOptions
): Promise<SpawnGithubResult>;
```

### 6. Register CLI command

**File**: `src/cli/commands/spawn-github.ts`

```typescript
export function registerSpawnGithubCommand(
  program: Command,
  container: CliContainer,
  options?: RegisterSpawnGithubCommandOptions
): void;
```

Register in `src/cli/program.ts`.

### 7. Export from SDK

**File**: `src/index.ts`

Add exports:
- `spawnGithub`
- `SpawnGithubOptions`
- `SpawnGithubResult`

## File Changes Summary

| File | Action |
|------|--------|
| `src/utils/github-url.ts` | Create |
| `src/utils/repo-dir.ts` | Create |
| `src/utils/git-clone.ts` | Create |
| `src/sdk/spawn-github-core.ts` | Create |
| `src/sdk/spawn-github.ts` | Create |
| `src/sdk/types.ts` | Add types |
| `src/cli/commands/spawn-github.ts` | Create |
| `src/cli/program.ts` | Register command |
| `src/index.ts` | Export SDK |

## Testing Strategy

### Unit Tests

1. **GitHub URL parser** (`tests/github-url.test.ts`)
   - Parse `owner/repo` format
   - Parse full HTTPS URLs
   - Parse git SSH URLs
   - Handle `.git` suffix
   - Invalid input errors

2. **Repo directory resolver** (`tests/repo-dir.test.ts`)
   - Deterministic output
   - Proper path construction

3. **Git clone utility** (`tests/git-clone.test.ts`)
   - Mock command runner
   - Test clone command construction
   - Test skip-if-exists logic
   - Test branch checkout

4. **spawn-github core** (`tests/spawn-github-core.test.ts`)
   - Full flow with mocked dependencies
   - Cleanup behavior
   - Keep flag behavior
   - Error handling

5. **spawn-github command** (`tests/spawn-github-command.test.ts`)
   - CLI argument parsing
   - Option handling
   - Integration with core

## Edge Cases

1. **Repository already cloned**: Reuse existing directory, optionally fetch updates
2. **Clone fails**: Clean error message, no partial directory left
3. **Agent spawn fails**: Still cleanup unless `--keep`
4. **Invalid GitHub URL**: Clear error message
5. **No git installed**: Check and error early
6. **Cleanup fails**: Log warning but don't fail the command

## Decisions

1. **Repo already exists**: Pull latest changes before spawning
2. **`--keep` flag**: Print the directory path for user reference
3. **Default service**: `claude-code`
4. **Private repos**: Relies on user's git credentials (SSH keys, credential helper)
