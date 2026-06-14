---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Gaslight ingest

Extract human prompts from local Claude and Codex traces, ask a selected agent to mine the prompts for recurring follow-up patterns, and write a generated gaslight config.

## 1. What we're building

Build gaslight ingest:

- Add `packages/agent-traces` with trace definitions, discovery, parsing, and normalization for each supported agent.
- Extend gaslight so ingest extracts human-authored prompts per trace, writes those prompts to a data file, and runs a selected analysis agent against that file.
- The analysis agent generates a `gaslight.yaml` variant. If `.poe-code/gaslight.yaml` already exists, write an agent-prefixed variant such as `.poe-code/codex-gaslight.yaml`.

Explicit non-goals:

- Do not make trace parsing part of core. Core only wires public API and CLI.
- Do not add provider-specific `if` or `case` logic to shared ingest flow. Agent-specific parsing lives behind registered trace readers.
- Do not persist raw human prompt extracts inside the project by default, because `.poe-code` is not globally ignored.
- Do not modify README without permission.

## 2. User-facing shape

### CLI

```console
$ poe-code gaslight ingest --sources claude,codex --agent codex --since 30d --limit 200
┌ gaslight ingest
◇ Discovering traces
◇ Extracted 173 human prompts from 48 traces
◇ Analyzing prompt patterns with codex
◇ Wrote .poe-code/codex-gaslight.yaml
└ Data file: /repo/.poe-code/ingest/human-prompts-123-456-789.jsonl
```

Default behavior:

- `--sources claude,codex` reads both supported local trace stores.
- `--agent <agent>` selects the analysis agent that will read the extracted prompt file and produce YAML.
- `--model <model>` forwards the model override to the analysis agent.
- `--cwd <path>` filters traces to the current workspace by default. Passing `--all-workspaces` disables that filter.
- `--since <duration>` defaults to `30d`.
- `--limit <n>` limits normalized human prompts after sorting newest first; default `200`.
- `--output <path>` overrides YAML output path.
- `--keep-data <path>` persists the extracted prompt file at an explicit path. Without it, the prompt file is created in an OS temp directory and removed unless `--debug` is enabled.
- `--yes` accepts defaults and does not prompt.

Collision behavior:

- If `.poe-code/gaslight.yaml` does not exist, write it.
- If it exists and `--output` is not provided, write `.poe-code/<agent>-gaslight.yaml`, where `<agent>` is the selected analysis agent id normalized for filenames.
- If that variant exists, append a numeric suffix: `.poe-code/codex-gaslight-2.yaml`.
- The generated variant is usable via `poe-code gaslight --config .poe-code/codex-gaslight.yaml docs/plans/foo.md --agent claude-code`.

### Generated YAML

The analysis agent writes a strict gaslight config shape:

```yaml
prompt: Implement
followups:
  - Did you validate the change with the most realistic command available?
  - Did you inspect the actual output instead of relying only on a passing unit test?
  - Is there any leftover implementation detail, generated file, or local state that should be cleaned up?
```

The package validates the generated file before moving it into place:

- `prompt` must be a non-empty string.
- `followups` must be a non-empty array of non-empty strings.
- Extra top-level keys are rejected for v1 so generated output stays compatible with the existing gaslight runner.

### SDK

```ts
import { ingestGaslight } from "@poe-code/agent-gaslight";

const result = await ingestGaslight({
  sources: ["claude", "codex"],
  analysisAgent: "codex",
  cwd: process.cwd(),
  since: "30d",
  limit: 200
});

// result.outputPath => ".poe-code/codex-gaslight.yaml"
```

### Trace package

```ts
import { collectHumanPrompts } from "@poe-code/agent-traces";

const prompts = await collectHumanPrompts({
  sources: ["claude", "codex"],
  cwd: process.cwd(),
  since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  limit: 200
});
```

## 3. Implementation details and technical decisions

### Autonomy audit

- Local Claude traces are available under `~/.claude/projects/<encoded-cwd>/*.jsonl`. This was confirmed locally for `/Users/kjopek/Workspace/poe-code`.
- Local Codex thread metadata is available in `~/.codex/state_5.sqlite`, table `threads`. Rows include `id`, `rollout_path`, `created_at`, `updated_at`, `source`, `model_provider`, `cwd`, `title`, `first_user_message`, `model`, and `preview`.
- Local Codex rollouts are available under paths like `~/.codex/sessions/YYYY/MM/DD/rollout-...jsonl`. Rollout JSONL records have top-level `type`, `timestamp`, and `payload`; user turns appear as `payload.type = "user_message"` and response input messages appear as `payload.type = "message"` with nested `input_text`.
- The repo does not currently depend on a SQLite library. Add `better-sqlite3` only if synchronous local reads are accepted by package lint and typecheck; otherwise use Node's `child_process` only for CLI is not acceptable for SDK. The preferred implementation is a small dependency in `packages/agent-traces`.
- No human input is required during implementation beyond normal local filesystem access.

### Package boundaries

`packages/agent-traces` owns:

- Discovering trace stores.
- Reading Claude JSONL and Codex SQLite/rollout JSONL.
- Normalizing traces into provider-neutral types.
- Filtering by workspace, date, source, and limit.
- Writing extracted prompts as JSONL for downstream analysis.

`packages/agent-gaslight` owns:

- `ingestGaslight`.
- Building the analysis prompt.
- Spawning the selected analysis agent.
- Validating and writing the generated YAML.
- Resolving output collision paths.

Core owns:

- CLI registration and SDK re-exports only.
- No trace parsing and no generation logic.

### Trace reader registry

Avoid shared provider branching by using declarative reader registration:

```ts
export interface TraceReader {
  id: AgentTraceSource;
  defaultRoots(homeDir: string): string[];
  discover(options: TraceDiscoverOptions): Promise<TraceReference[]>;
  read(reference: TraceReference, options: TraceReadOptions): Promise<NormalizedTrace>;
}

export const traceReaders = [claudeTraceReader, codexTraceReader] satisfies TraceReader[];
```

Shared code resolves readers by id through a `Map` built from `traceReaders`. Adding a new source means adding one reader file and registering it in `src/readers/index.ts`.

### Normalized trace shape

```ts
export type AgentTraceSource = "claude" | "codex";

export interface TraceReference {
  source: AgentTraceSource;
  id: string;
  path?: string;
  cwd?: string;
  updatedAt?: Date;
  title?: string;
}

export interface NormalizedTrace {
  source: AgentTraceSource;
  id: string;
  path?: string;
  cwd?: string;
  title?: string;
  createdAt?: Date;
  updatedAt?: Date;
  turns: NormalizedTraceTurn[];
}

export interface NormalizedTraceTurn {
  id?: string;
  role: "human" | "assistant" | "tool" | "system";
  text: string;
  timestamp?: Date;
  sourceKind?: string;
}

export interface HumanPromptRecord {
  traceId: string;
  source: AgentTraceSource;
  cwd?: string;
  title?: string;
  timestamp?: string;
  text: string;
}
```

### Claude reader

Discovery:

- Convert workspace cwd to Claude project directory encoding by replacing path separators with `-`, matching existing local paths such as `~/.claude/projects/-Users-kjopek-Workspace-poe-code`.
- Read `*.jsonl` under that project directory when a cwd filter exists.
- When `--all-workspaces` is passed, scan `~/.claude/projects/*/*.jsonl`.

Parsing:

- Parse JSONL line by line.
- Human prompts come from records with `type = "user"`, `message.role = "user"`, and `message.content`.
- `message.content` may be a string or an array. Extract text from string blocks and text-like object blocks only; ignore attachments and tool results.
- Use `sessionId`, `uuid`, `timestamp`, `cwd`, and `gitBranch` when present.

### Codex reader

Discovery:

- Open `~/.codex/state_5.sqlite`.
- Query `threads` ordered by `updated_at` descending.
- Filter by `cwd = options.cwd` unless `allWorkspaces` is true.
- Filter by `updated_at`/`updated_at_ms` against `since`.
- Use `rollout_path` for full prompt extraction when present.

Parsing:

- Prefer rollout JSONL because it contains full turn history.
- Read rollout records line by line.
- Extract `payload.type = "user_message"` from `payload.message` or `payload.text_elements`.
- Also accept response input messages where `payload.type = "message"`, `payload.role = "user"`, and nested content blocks are `input_text`.
- Fall back to `threads.first_user_message` when rollout is missing or unreadable.
- Include `source`, `model`, and `title` as metadata when available.

### Analysis prompt

`agent-gaslight` writes the extracted records to JSONL and sends the selected agent a prompt like:

```text
Read this JSONL file of human prompts from coding-agent traces:
<absolute-data-file>

Generate a gaslight.yaml file that captures recurring follow-up prompts the human uses after agent work.
Return only YAML with this exact shape:
prompt: <string>
followups:
  - <string>

Rules:
- Prefer concise followups that generalize across tasks.
- Do not include project secrets, file paths, names, tokens, or one-off task details.
- Preserve the user's direct style when it is reusable.
- Use 3 to 8 followups.
```

The selected agent receives the path, not an inline dump. The default path is under `<cwd>/.poe-code/ingest/` so read-mode agents can access it from the workspace. That keeps command length stable and makes large prompt sets feasible.

### Output writing

- Generate into a temp file first.
- Parse with `yaml` and validate the strict v1 gaslight config shape.
- Ensure `.poe-code` exists only when actually writing.
- Move the temp file to the resolved output path.
- Never merge into an existing config during v1; generated variants are separate files.

### Existing gaslight runner change

Add `configPath?: string` to gaslight run options and `--config <path>` to the CLI. This lets generated variants run without replacing `.poe-code/gaslight.yaml`.

`loadGaslightConfig` remains the default project-then-global lookup when no explicit config path is provided.

## 4. Interfaces and test plan

### `@poe-code/agent-traces`

```ts
export interface CollectHumanPromptsOptions {
  sources?: AgentTraceSource[];
  cwd?: string;
  homeDir?: string;
  since?: Date;
  limit?: number;
  allWorkspaces?: boolean;
  fs?: AgentTraceFileSystem;
  sqlite?: SqliteTraceDatabaseFactory;
}

export function collectHumanPrompts(
  options?: CollectHumanPromptsOptions
): Promise<HumanPromptRecord[]>;

export function writeHumanPromptJsonl(
  records: HumanPromptRecord[],
  path: string,
  fs?: AgentTraceFileSystem
): Promise<void>;
```

### `@poe-code/agent-gaslight`

```ts
export interface GaslightIngestOptions {
  sources?: AgentTraceSource[];
  analysisAgent: string;
  model?: string;
  cwd?: string;
  homeDir?: string;
  since?: string | Date;
  limit?: number;
  allWorkspaces?: boolean;
  outputPath?: string;
  keepDataPath?: string;
  onEvent?: (event: GaslightIngestEvent) => void;
  fs?: GaslightFileSystem;
  spawn?: GaslightSpawn;
}

export type GaslightIngestEvent =
  | { type: "traces.discovered"; count: number }
  | { type: "prompts.extracted"; traces: number; prompts: number }
  | { type: "analysis.started"; agent: string; dataPath: string }
  | { type: "config.written"; path: string };

export interface GaslightIngestResult {
  outputPath: string;
  dataPath: string;
  promptCount: number;
  traceCount: number;
}

export function ingestGaslight(options: GaslightIngestOptions): Promise<GaslightIngestResult>;
```

### Unit tests

- `packages/agent-traces/src/readers/claude.test.ts`: memfs JSONL fixtures prove Claude project path discovery, array/string content extraction, cwd filtering, and malformed-line tolerance.
- `packages/agent-traces/src/readers/codex.test.ts`: mocked SQLite rows plus memfs rollout fixtures prove rollout extraction, `first_user_message` fallback, cwd filtering, and date filtering.
- `packages/agent-traces/src/collect.test.ts`: registered readers are selected by source id without provider conditionals; records are sorted newest first and limited.
- `packages/agent-traces/src/jsonl.test.ts`: prompt records write as valid JSONL and do not mutate text.
- `packages/agent-gaslight/src/ingest.test.ts`: mocked prompt records plus mocked spawn prove the analysis agent receives a file path, generated YAML is validated, default output collision resolves to `<agent>-gaslight.yaml`, and invalid YAML fails without writing final output.
- `packages/agent-gaslight/src/config.test.ts`: explicit `configPath` loads that file and default lookup remains unchanged.
- `src/cli/commands/gaslight.test.ts`: `gaslight ingest` flags map to SDK options, `--yes` does not prompt, and `gaslight --config` forwards the path to `runGaslight`.

All code-change tests are written first. File-changing tests use memfs or injected filesystems; no tests query LLMs.

### Real-world test

1. `npm run dev -- gaslight ingest --sources claude,codex --agent codex --since 7d --limit 25 --yes --output .poe-code/gaslight-ingest-smoke.yaml`
   Expected: command exits 0, prints extracted prompt count, and writes `.poe-code/gaslight-ingest-smoke.yaml`.
   Observation: the YAML parses and contains `prompt` plus at least one `followups` entry.

2. `npm run dev -- gaslight --config .poe-code/gaslight-ingest-smoke.yaml docs/plans/agent-gaslight.md --agent claude-code --mode read --yes`
   Expected: gaslight reads the generated variant and starts the configured sequence.
   Observation: round 1 uses `prompt` from the generated YAML.

3. `npm run screenshot-poe-code -- gaslight ingest --help`
   Expected: help text fits the existing CLI design language.
   Observation: screenshot shows no wrapping or overlap regressions.

### Must-work checklist

- [ ] Claude traces produce human prompt records from `~/.claude/projects/<encoded-cwd>/*.jsonl`; prove with `npm run test -- packages/agent-traces/src/readers/claude.test.ts`.
- [ ] Codex traces produce human prompt records from `~/.codex/state_5.sqlite` and rollout JSONL; prove with `npm run test -- packages/agent-traces/src/readers/codex.test.ts`.
- [ ] Ingest gives the selected agent a prompt file path, not inline prompt data; prove with `npm run test -- packages/agent-gaslight/src/ingest.test.ts`.
- [ ] Existing `.poe-code/gaslight.yaml` is preserved and agent-prefixed variants are created; prove with `npm run test -- packages/agent-gaslight/src/ingest.test.ts`.
- [ ] Generated variants can be selected by `--config`; prove with `npm run test -- packages/agent-gaslight/src/config.test.ts src/cli/commands/gaslight.test.ts`.
- [ ] CLI help is visually acceptable; prove with `npm run screenshot-poe-code -- gaslight ingest --help`.

## 5. Code plan

### Files to create

| File                                          | Purpose                                                        |
| --------------------------------------------- | -------------------------------------------------------------- |
| `packages/agent-traces/package.json`          | Package metadata and scripts.                                  |
| `packages/agent-traces/tsconfig.json`         | Package TypeScript config.                                     |
| `packages/agent-traces/README.md`             | Trace roots, config options, exported types, privacy behavior. |
| `packages/agent-traces/src/types.ts`          | Normalized trace and prompt record definitions.                |
| `packages/agent-traces/src/readers/claude.ts` | Claude JSONL trace reader.                                     |
| `packages/agent-traces/src/readers/codex.ts`  | Codex SQLite and rollout JSONL trace reader.                   |
| `packages/agent-traces/src/readers/index.ts`  | Reader registry.                                               |
| `packages/agent-traces/src/collect.ts`        | Source selection, filtering, sorting, limiting.                |
| `packages/agent-traces/src/jsonl.ts`          | Human prompt JSONL writer.                                     |
| `packages/agent-traces/src/index.ts`          | Public exports.                                                |
| `packages/agent-traces/src/*.test.ts`         | Fast unit tests with memfs and mocked SQLite.                  |
| `packages/agent-gaslight/src/ingest.ts`       | Gaslight ingest orchestration.                                 |
| `packages/agent-gaslight/src/ingest.test.ts`  | Ingest tests.                                                  |

### Files to change

| File                                    | Change                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-gaslight/src/types.ts`  | Add `configPath` to run options and ingest types.                                                                                 |
| `packages/agent-gaslight/src/config.ts` | Support explicit config path and strict generated-config validation helper.                                                       |
| `packages/agent-gaslight/src/run.ts`    | Forward `configPath` to config loading.                                                                                           |
| `packages/agent-gaslight/src/index.ts`  | Export ingest API.                                                                                                                |
| `packages/agent-gaslight/package.json`  | Depend on `@poe-code/agent-traces`.                                                                                               |
| `packages/agent-gaslight/README.md`     | Document package config options and env/config paths after user permission for top-level README only; package README is required. |
| `src/sdk/gaslight.ts`                   | Re-export ingest types and functions.                                                                                             |
| `src/cli/commands/gaslight.ts`          | Add `--config` to run command and `ingest` subcommand.                                                                            |
| `src/cli/commands/gaslight.test.ts`     | Cover CLI option mapping.                                                                                                         |
| `src/index.ts`                          | Re-export ingest API if public SDK parity requires it.                                                                            |
| `package.json`                          | Add `packages/agent-traces/dist` to publish files and workspace dev dependency if needed.                                         |
| `package-lock.json`                     | Lock new workspace package and SQLite dependency.                                                                                 |

### Build order

1. Add `packages/agent-traces` scaffolding, README, and tests for Claude reader.
2. Implement Claude reader until tests pass.
3. Add Codex reader tests with mocked SQLite and rollout fixtures.
4. Implement Codex reader and shared collection.
5. Add gaslight `configPath` tests, then implement explicit config loading and CLI `--config`.
6. Add ingest orchestration tests with mocked `collectHumanPrompts` and mocked spawn.
7. Implement `ingestGaslight`.
8. Add CLI ingest tests and command wiring.
9. Run targeted tests, lint/types for touched packages, and screenshot help validation.
