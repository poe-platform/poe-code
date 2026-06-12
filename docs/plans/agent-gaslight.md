---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Agent gaslight

Run an agent on any plan; every time it finishes, resume the same conversation with the next follow-up from a global `gaslight.yaml` until the list is exhausted.

## 1. What we're building

A gaslight harness, very simple. A global `gaslight.yaml` holds the initial prompt (`Implement`) and a list of follow-up prompts. The agent runs on a plan; whenever it finishes, the conversation is resumed with the next follow-up until the list runs out:

- Is this best you can do?
- Did you test it well? Like real end to end test?
- Did you forget something?

Plans need no gaslight frontmatter — it runs on any plan (e.g. `kind: plan`).

Non-goals:

- No conditional follow-ups — the list is consumed in order, always.
- No per-plan gaslight config.
- No harness-pair (`.md`/`.ajs`) scaffolding.

## 2. User-facing shape

### Config

```yaml
# .poe-code/gaslight.yaml (project) or ~/.poe-code/gaslight.yaml (global)
prompt: Implement
followups:
  - Is this best you can do?
  - Did you test it well? Like real end to end test?
  - Did you forget something?
```

`prompt` opens the conversation with the plan path appended (round 1 sends `Implement docs/plans/foo.md`); `followups` are sent one per finish, in order. Project file wins over the global one.

### CLI

```console
$ poe-code gaslight docs/plans/foo.md --agent claude-code --model Claude-Sonnet-4.5
┌ gaslight
◇ Round 1/4 · plan: docs/plans/foo.md
◇ Round 2/4 · Is this best you can do?
◇ Round 3/4 · Did you test it well? Like real end to end test?
◇ Round 4/4 · Did you forget something?
◇ 4 rounds finished
└ Usage: 412.3k input / 38.1k output tokens · $1.84
```

Standard interactive rules:

- `poe-code gaslight` — prompts for plan (picked from the plan directory), agent, and model.
- `poe-code gaslight docs/plans/foo.md` — prompts only for agent and model.
- `--yes` — accepts defaults, no prompts (CI).
- `--mode <read|edit|yolo>` — spawn mode, defaults to `edit`.

Installation:

```console
$ poe-code gaslight install --local
```

The install subcommand scaffolds the matching project or global `gaslight.yaml`. Existing config is preserved unless `--force` is passed.

Each round shows a spinner while the agent works (rounds always exceed 700ms).

### SDK

```ts
import { runGaslight } from "@poe-code/agent-gaslight";

const result = await runGaslight({
  planPath: "docs/plans/foo.md",
  agent: "claude-code",
  model: "Claude-Sonnet-4.5"
});
// result.rounds: [{ prompt, summary, threadId }, ...]
```

The CLI uses the SDK; same options, same names.

## 3. Implementation details and technical decisions

### New package `packages/agent-gaslight`

Core only wires the command; all logic lives in the package. The package knows nothing about logging or dry run — progress flows through an `onEvent` callback, rendering stays in the CLI layer (design_system).

### The loop

1. Check the plan file exists, then open with `<config prompt> <plan path>` (e.g. `Implement docs/plans/foo.md`) — the path (relative to `cwd`) is handed to the agent, which reads the plan itself. No frontmatter parsing, no `kind` validation — any markdown file works.
2. `spawn(agent, { prompt, model, mode, cwd })` via `@poe-code/agent-spawn`.
3. Take `threadId` from the result; for each follow-up, `spawn(agent, { prompt: followup, resumeThreadId })`, carrying the newest `threadId` forward (providers may rotate ids between turns).
4. Sum usage across rounds; return the transcript.

Everything needed already exists in `@poe-code/agent-spawn`: `SpawnOptions.resumeThreadId` maps declaratively to each provider's resume invocation ([claude-code.ts:31](../../packages/agent-spawn/src/configs/claude-code.ts#L31), [codex.ts:27](../../packages/agent-spawn/src/configs/codex.ts#L27)), `SpawnResult.threadId` carries the session id back, and unsupported providers already throw `Agent "X" does not support resumeThreadId.` ([spawn.ts:177](../../packages/agent-spawn/src/spawn.ts#L177)). No changes to agent-spawn, agent-script, or agent-harness.

### Config loading

- Lookup order: `<cwd>/.poe-code/gaslight.yaml`, then `<home>/.poe-code/gaslight.yaml`. First hit wins, no merging.
- Parsed with the `yaml` package (already a dependency), validated with plain TS guards: `prompt` must be a non-empty string, `followups` a non-empty array of non-empty strings.
- No file found → error naming both searched paths with a copy-pasteable example config.

### Edge cases

- **Agent without resume support** (file-kind agents): the spawn layer throws its existing error on round 2; surfaced as-is.
- **No `threadId` on a result**: fail immediately with `agent returned no threadId; cannot resume the conversation` instead of burning follow-ups on fresh sessions.
- **Agent fails mid-list** (non-zero exit): stop, report the round that failed and the rounds completed.
- **Missing plan file**: error before any spawn.
- **Invalid gaslight.yaml** (missing `prompt`, empty `followups`, non-string entries): validation error naming the file.

## 4. Interfaces and test plan

### Package API (`@poe-code/agent-gaslight`)

```ts
export type GaslightOptions = {
  planPath: string;
  agent: string;
  model?: string;
  mode?: "read" | "edit" | "yolo"; // default "edit"
  cwd?: string;
  prompt?: string; // bypasses config lookup when set
  followups?: string[]; // bypasses config lookup when set
  onEvent?: (event: GaslightEvent) => void;
  signal?: AbortSignal;
};

export type GaslightEvent =
  | { type: "round.started"; round: number; total: number; prompt: string }
  | { type: "round.finished"; round: number; total: number; summary: string };

export type GaslightRound = { prompt: string; summary: string; threadId?: string };

export type GaslightResult = { rounds: GaslightRound[]; usage?: SpawnUsage };

export function runGaslight(options: GaslightOptions): Promise<GaslightResult>;

export function loadGaslightConfig(
  cwd: string,
  homeDir: string,
  fs?: GaslightFs // injectable for memfs tests
): Promise<{ prompt: string; followups: string[]; path: string }>;
```

`runGaslight` takes spawn as an injectable seam (same pattern as other packages wrapping agent-spawn) so tests never spawn a real agent.

### Tests (TDD — test first per change)

| Test                                                                                                                           | File                                                   | Proves         |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------- |
| project config beats global; `prompt` + `followups` parsing; missing/invalid → typed errors                                    | `packages/agent-gaslight/src/config.test.ts` (memfs)   | config loading |
| round 1 prompt = config prompt + plan path; follow-up N sends `resumeThreadId` from round N-1; newest threadId carried forward | `packages/agent-gaslight/src/run.test.ts` (mock spawn) | the loop       |
| missing threadId → fails before round 2; mid-list failure reports completed rounds; usage summed                               | `packages/agent-gaslight/src/run.test.ts`              | edge cases     |
| prompts for plan/agent/model when args missing; no prompts when all given; `--yes` takes defaults                              | `src/cli/commands/gaslight.test.ts`                    | CLI rules      |

All in-memory: memfs for files, mocked spawn for agents — no real LLM calls, fast.

### Manual validation

- `npm run screenshot-poe-code -- gaslight --help` and a mocked run — verify spinner, round lines, usage line follow the design system.
- Spot test: `npm run dev -- gaslight docs/plans/<small-plan>.md --agent claude-code` against a trivial plan; confirm the provider log shows `--resume <threadId>` on rounds 2+.

### Autonomy checklist

- [ ] `npm test` green in `packages/agent-gaslight` and root CLI tests
- [ ] Package README lists the config lookup paths and all options
- [ ] Help screenshot reviewed
- [ ] No provider `if`/`case` anywhere; no logging/dry-run knowledge inside the package

## 5. Code plan

### Files to create

| File                                                            | Purpose                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/agent-gaslight/package.json`, `tsconfig.json`         | Package scaffolding (mirror `agent-spawn`)              |
| `packages/agent-gaslight/README.md`                             | Usage, config lookup paths, all options                 |
| `packages/agent-gaslight/src/config.ts`                         | `loadGaslightConfig` + TS guards                        |
| `packages/agent-gaslight/src/run.ts`                            | `runGaslight` loop                                      |
| `packages/agent-gaslight/src/types.ts`                          | Options/event/result types                              |
| `packages/agent-gaslight/src/index.ts`                          | Public exports                                          |
| `packages/agent-gaslight/src/config.test.ts`, `src/run.test.ts` | Package tests                                           |
| `src/cli/commands/gaslight.ts`                                  | Command wiring: args, prompts, spinner, event rendering |
| `src/cli/commands/gaslight.test.ts`                             | CLI prompting/flag tests                                |

### Files to change

| File                                   | Change                                    |
| -------------------------------------- | ----------------------------------------- |
| `src/cli/index.ts` (command registry)  | Register the `gaslight` command           |
| `src/sdk.ts` (public SDK surface)      | Re-export `runGaslight`                   |
| root `package.json` / workspace config | Add the package to the workspace + bundle |

### Build order (green at every step)

1. Package scaffolding + `config.ts` with tests (memfs).
2. `run.ts` loop with tests (mock spawn).
3. CLI command + tests; register command.
4. SDK re-export; README; screenshot check.
