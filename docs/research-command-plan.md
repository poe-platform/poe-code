# Plan: `poe-code research` Command

## Context

Add a new `research` command that spawns a coding agent in read-only mode against a codebase (local or cloned from GitHub), streams ACP output to the terminal, and saves the result as a markdown file with YAML frontmatter to `~/.poe-code/research/`.

## Command Signature

```
poe-code research "prompt"                              # uses -C/--cwd or env.cwd
poe-code research --path /some/dir "prompt"             # local dir (overrides -C/--cwd)
poe-code research --github username/repo "prompt"       # clone from GH
poe-code research --github git@gh:o/r.git "prompt"      # SSH URL

# spawn-compatible flags
--agent <agent>       # default: first configured spawn-capable agent
--model <model>       # model override
--mode <mode>         # default: read (vs spawn's yolo)
-C, --cwd <path>     # working directory override
--stdin               # read prompt from stdin (also accept '-' prompt)
--keep                # keep cloned repo (with --github)
[agentArgs...]        # forwarded to agent CLI
```

## Files to Create

### `src/cli/commands/research.ts` — Command registration + action handler

**`registerResearchCommand(program, container)`** following spawn.ts pattern:

1. Resolve `--agent` flag. If missing and `--yes` not set, prompt for agent (interactive CLI parity). If `--yes`, default to first spawn-capable service from registry.
2. Resolve source:
   - `--github`: clone into `~/.poe-code/repos/<slug>-<hash8>/` via `git clone --depth 1` (if dir exists, delete and re-clone)
   - `--path`: resolve as absolute path
   - neither: use `-C`/cwd
3. Prepend research system prompt to user's prompt
4. Call `spawnSdk()` with `mode: "read"` default
5. Tee the ACP stream: intercept `agent_message` events to accumulate markdown, yield events through to `renderAcpStream()`
6. Save output to `~/.poe-code/research/<timestamp>-<slug>.md` with YAML frontmatter
7. Build resume command from `threadId` when available (most agents support this; omit from frontmatter when not)
8. Cleanup cloned repo in `finally` block — only if we cloned it this run (skip if dir pre-existed). `--keep` also prevents cleanup.

Key internal functions (all in same file, not extracted):

- `resolveSource()` — determine cwd from --github/--path/cwd (precedence: `--github` > `--path` > `-C/--cwd` > env.cwd)
- `teeAcpStream()` — wrap async iterable to capture agent_message text while passing events through
- `buildResearchPrompt()` — prepend system instructions to user prompt
- `buildResearchDocument()` — format YAML frontmatter + markdown body
- `buildClonePath()` — `~/.poe-code/repos/<slug>-<sha256-8chars>`
- `extractRepoSlug()` — parse owner-repo from URL formats
- `buildOutputPath()` — `~/.poe-code/research/<YYYYMMDD-HHmmss>-<prompt-slug>.md` (no `:` for portability)
- `resolveGithubCloneUrl()` — `username/repo` → `https://github.com/username/repo.git`, SSH URLs passed through

### `src/cli/commands/research.test.ts` — Unit tests (TDD, memfs)

Tests for pure functions:

- `buildSlug` — edge cases (special chars, long prompts, empty)
- `buildResearchPrompt` — contains system instructions + user prompt
- `buildResearchDocument` — YAML frontmatter format, optional github/resume fields
- `buildClonePath` — deterministic hash, readable slug prefix
- `extractRepoSlug` — `owner/repo`, `ssh://...`, `git@...:owner/repo.git`
- `resolveGithubCloneUrl` — shorthand vs SSH vs HTTPS

Tests for source resolution:

- `--github` calls `git clone --depth 1` via commandRunner
- `--path` resolves to absolute path
- Default uses `-C/--cwd` when provided, else env.cwd
- `--stdin` / `-` prompt reading behavior

Tests for action handler (mock spawnSdk):

- Default mode is `read`
- Agent resolved from `--agent` flag or first spawn-capable service
- Prompt includes research system instructions
- Output file saved with correct frontmatter
- `agent_message` events captured in output
- Cloned repo cleaned up after completion (only if freshly cloned this run)
- Cloned repo preserved with `--keep`
- Pre-existing clone dir is never deleted
- Cleanup happens even on spawn failure (try/finally)
- Model and agentArgs forwarded to spawnSdk
- Resume command included in frontmatter when threadId present

### `src/sdk/research.ts` — SDK function

```ts
export function research(prompt: string, options?: ResearchOptions): {
  events: AsyncIterable<AcpEvent>;
  result: Promise<ResearchResult>;
}
```

Wraps spawn with research defaults (mode: read, system prompt prepended). Captures markdown output. Saves to file. Returns `ResearchResult` with `markdownOutput` and `outputPath`.

## Files to Modify

### `src/sdk/types.ts`

Add:

```ts
export interface ResearchOptions {
  github?: string;
  path?: string;
  cwd?: string;
  model?: string;
  mode?: SpawnMode;
  agent?: string;
  args?: string[];
  keep?: boolean;
}

export interface ResearchResult extends SpawnResult {
  markdownOutput: string;
  outputPath: string;
}
```

### `src/cli/program.ts`

- Import `registerResearchCommand`
- Call `registerResearchCommand(program, container)` in `bootstrapProgram()`
- Add to `formatHelpText()` commandRows:

  ```ts
  { name: "research", args: "<prompt>", description: "Research a codebase using a coding agent" }
  ```

### `src/index.ts`

- Export `research` from SDK
- Export `ResearchOptions`, `ResearchResult` types

### `src/cli/commands/shared.ts`

- Extract `buildResumeCommand(canonicalService, threadId, cwd): string | undefined` from spawn.ts resume logic

### `src/cli/commands/spawn.ts`

- Refactor to use `buildResumeCommand()` from shared.ts (replace inline resume logic)

## Output File Format

```markdown
---
research_prompt: "user's original prompt"
agent: "claude-code"
path: "/Users/me/.poe-code/repos/owner-repo-a1b2c3d4"
github: "owner/repo"
resume_session_cmd: "claude --resume abc123"
---

<raw markdown output from the agent>
```

Notes:
- YAML frontmatter must escape quotes/newlines safely.
- Output filename uses `YYYYMMDD-HHmmss` to avoid `:` in filenames.
- Tests must use `memfs` for file writes (snapshots on disk only).

## ACP Stream Tee Approach

`renderAcpStream()` in `packages/agent-spawn/src/acp/renderer.ts` consumes `AsyncIterable<AcpEvent>`. We wrap the iterable:

```ts
function teeAcpStream(events: AsyncIterable<AcpEvent>) {
  const chunks: string[] = [];
  const teed = async function* () {
    for await (const event of events) {
      if (event.event === "agent_message") {
        chunks.push((event as AgentMessageEvent).text);
      }
      yield event;
    }
  };
  return { teed: teed(), getOutput: () => chunks.join("") };
}
```

This avoids modifying `@poe-code/agent-spawn` package.

## Implementation Order (TDD)

1. Add `ResearchOptions` / `ResearchResult` types to `src/sdk/types.ts`
2. Write tests for pure utility functions → implement them in `research.ts`
3. Write tests for `resolveSource()` → implement (mock commandRunner for git clone)
4. Write tests for action handler → implement `registerResearchCommand()`
5. Extract `buildResumeCommand()` to `shared.ts`, refactor `spawn.ts`
6. Implement `src/sdk/research.ts` + tests
7. Wire up in `program.ts` and `index.ts`
8. `npm run test && npm run lint`
9. `npm run e2e:verbose` (spawn is touched via shared resume logic)
10. Screenshot: `npm run screenshot-poe-code -- research --help`

## Verification

1. `npm run test` — all unit tests pass
2. `npm run lint` — no lint errors
3. `npm run screenshot-poe-code -- research --help` — verify help output looks correct
4. `npm run dev -- research --help` — verify command is registered
5. Manual: `npm run dev -- research "explain the project structure"` — verify streaming + file output
6. Manual: `npm run dev -- research --github some-public/repo "what does this do" --keep` — verify clone + research + keep

## Additional Adjustments (per review)

- `--github` with existing clone should be non-destructive:
  - If repo has uncommitted changes (`git status --porcelain`), skip any update and use the working tree as-is (log a warning).
  - If clean, attempt `git pull --ff-only` (or `git fetch` + `git merge --ff-only`) to update safely; if it fails, continue with existing state and log.
- Prompt behavior: prompt for agent/model unless `--yes` is supplied (aligns with interactive CLI defaults). `--yes` accepts defaults.
- Support `--stdin` and `-` prompt semantics consistent with `spawn`.
