# Ralph: Simple Iterative Loop

## Summary

Ralph is a simple iterative loop: take a markdown doc, run an agent with it N times, with overbaking protection.

### CLI

```
poe-code ralph run 20 path/to/doc.md    # run 20 iterations with specific doc
poe-code ralph run                       # interactive: select doc from .poe-code/ralph/plans/, prompt for iterations
```

### Core behavior

- Each iteration: spawn agent in yolo mode with the markdown doc content as prompt
- Success = exit code 0, failure = non-zero
- Overbaking: if N consecutive failures (default 3), prompt user to continue/skip/abort
- No stories, no YAML parsing, no completion detection

## Package: `packages/ralph/`

### Files

```
packages/ralph/
  package.json          # @poe-code/ralph, deps: @poe-code/design-system
  tsconfig.json
  src/
    index.ts
    index.test.ts
    types.ts
    overbaking/
      detector.ts
      detector.test.ts
    discovery/
      discovery.ts
      discovery.test.ts
    run/
      ralph.ts
    testing/
      simulation.ts
      simulation.test.ts
```

### Types (`types.ts`)

```ts
export interface RalphFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ isFile(): boolean; mtimeMs: number }>;
}

export interface AgentRunInput {
  agent: string;
  prompt: string;
  cwd: string;
  model?: string;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type OverbakeAction = "continue" | "abort";

export type RalphStopReason = "completed" | "max_iterations" | "overbake_abort" | "cancelled";

export interface RalphRunResult {
  stopReason: RalphStopReason;
  docPath: string;
  iterationsCompleted: number;
  totalDurationMs: number;
}

export interface RalphRunOptions {
  agent: string;
  cwd: string;
  homeDir: string;
  model?: string;
  docPath: string;
  maxIterations: number;
  maxFailures?: number;       // overbaking threshold, default 3
  fs?: RalphFileSystem;
  runAgent?: (input: AgentRunInput) => Promise<AgentRunResult>;
  promptOverbake?: (args: {
    consecutiveFailures: number;
    threshold: number;
  }) => Promise<OverbakeAction>;
  onIterationStart?: (iteration: number, maxIterations: number) => void;
  onIterationComplete?: (iteration: number, durationMs: number, success: boolean) => void;
  onOverbakeWarning?: (consecutiveFailures: number, threshold: number) => void;
  signal?: AbortSignal;
}
```

### Overbaking Detector (`overbaking/detector.ts`)

Port from old ralph. Simplified: no storyId tracking (single global tracker).

```ts
export class OverbakingDetector {
  readonly threshold: number;
  private consecutiveFailures = 0;

  record(success: boolean): { consecutiveFailures: number; overbaked: boolean; shouldWarn: boolean }
}
```

### Discovery (`discovery/discovery.ts`)

Scan `.poe-code/ralph/plans/` (local) and `~/.poe-code/ralph/plans/` (global) for `*.md` files. Return candidates sorted by name.

```ts
export async function discoverDocs(options: {
  cwd: string;
  homeDir: string;
  fs?: RalphFileSystem;
}): Promise<Array<{ path: string; displayPath: string }>>
```

### Run loop (`run/ralph.ts`)

```ts
export async function runRalph(options: RalphRunOptions): Promise<RalphRunResult>
```

Loop: read doc once, for each iteration spawn agent with doc content as prompt. Track overbaking. Return result.

### Testing simulation (`testing/simulation.ts`)

memfs-based test harness, same pattern as pipeline's simulation.

## SDK: `src/sdk/ralph.ts`

Thin wrapper providing `runAgent` via `sdkSpawn` + `renderAcpStream`, same pattern as `src/sdk/pipeline.ts`.

## CLI: `src/cli/commands/ralph.ts`

```ts
export function registerRalphCommand(program: Command, container: CliContainer): void
```

Command: `poe-code ralph run [iterations] [doc]`
- `--agent <name>` (default: claude-code)
- `--model <model>`
- `--max-failures <n>` (default: 3)

Interactive prompts when args missing (unless --yes):
- Agent selection
- Doc selection from discovery
- Iteration count (default prompt, no default value)

Wire into `src/cli/program.ts`.

## Implementation Order (TDD)

1. Package scaffold (package.json, tsconfig.json, types.ts)
2. Overbaking detector (test → impl)
3. Discovery (test → impl)
4. Testing simulation harness
5. Run loop (test via simulation → impl)
6. Package index + exports test
7. SDK layer
8. CLI command + wire into program.ts
9. Screenshot verification
10. Commit
