---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Gaslight Crash Resume

Persist Gaslight progress so a crashed multi-round agent run can resume from the last completed round instead of losing the provider thread.

## 1. What we're building

Make `poe-code gaslight` resumable across process crashes.

When a Gaslight run completes one or more rounds and then the supervisor crashes, the next run must be able to continue from the next unfinished round with the last successful provider thread id. It must not restart the plan from round 1, lose completed-round summaries, or build an invalid provider resume invocation such as a `codex exec resume` command with misplaced `-s` mode flags.

The scope includes:

- Durable per-run Gaslight state under `.poe-code/` that records a stable run UUID, per-invocation attempt UUIDs, selected plans, config-derived prompts, completed rounds, thread ids, summaries, usage, and archived plans.
- CLI support to resume a prior Gaslight run explicitly.
- SDK support for callers that need deterministic resume behavior outside the CLI.
- Clear mismatch errors when the user tries to resume with a different agent, model, mode, plan list, or prompt sequence.
- Resume-safe multi-plan behavior when earlier plans were already archived before the crash.
- Validation coverage for provider resume argument order, especially Codex.

Explicit non-goals:

- Do not replace the lower-level `agent-script` snapshot system.
- Do not add provider-specific branching to Gaslight; provider behavior stays behind `agent-spawn` config.
- Do not attempt exact recovery for a process killed while an agent spawn is still in flight unless the completed spawn result was already returned to Gaslight and checkpointed.
- Do not edit README files without explicit user permission.
- Do not add unit tests for GitHub workflows.

## 2. User-facing shape

CLI:

```sh
poe-code gaslight docs/plans/feature.md --agent codex --model gpt-5
```

During the run, Gaslight writes a checkpoint file automatically.
When the full run succeeds, Gaslight deletes that checkpoint file automatically.

If the process crashes after round 1 of 8, rerun with:

```sh
poe-code gaslight docs/plans/feature.md --agent codex --model gpt-5 --resume
```

Expected resumed behavior:

```text
gaslight
Resume: docs/plans/feature.md round 2/8 from .poe-code/gaslight/<fingerprint>.json
Run: 2f2f0a7e-8f65-4d64-8b7b-67d9b4b6cf1a
Attempt: 017fe02d-a56a-4888-b0fd-f2ba64c6ee44
...
1 plans, 8 rounds finished
Usage: ...
```

If checkpoint state exists but `--resume` is not passed, the CLI must not silently duplicate work. It should fail with a concise recovery message:

```text
Gaslight state already exists for docs/plans/feature.md.
Resume with --resume or discard it with --reset.
```

To intentionally discard stale state:

```sh
poe-code gaslight docs/plans/feature.md --agent codex --model gpt-5 --reset
```

For non-default state locations:

```sh
poe-code gaslight docs/plans/feature.md --state-path .poe-code/gaslight/http-readiness.json --resume
```

SDK:

```ts
await runGaslight({
  planPaths: ["docs/plans/feature.md"],
  agent: "codex",
  model: "gpt-5",
  resume: true,
  statePath: ".poe-code/gaslight/feature.json"
});
```

## 3. Implementation details and technical decisions

Autonomy audit:

- No external credentials are needed for unit coverage; tests use injected `spawn` functions and `memfs`.
- No local network listeners are needed.
- Screenshot validation is needed only because the CLI help/output changes visually; use `npm run screenshot-poe-code -- gaslight --help`.
- Real agent resume behavior can be spot-tested with the configured local Codex provider, but unit tests must prove command construction without depending on a live LLM.

State model:

```ts
export interface GaslightState {
  version: 1;
  runId: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  agent: string;
  model?: string;
  mode: "read" | "edit" | "yolo";
  configHash: string;
  planPaths: string[];
  promptsByPlan: string[][];
  attempts: GaslightAttemptState[];
  plans: GaslightPlanState[];
  usage?: SpawnUsage;
}

export interface GaslightAttemptState {
  attemptId: string;
  kind: "initial" | "resume";
  startedAt: string;
  finishedAt?: string;
  status: "running" | "failed" | "completed";
  resumedFromAttemptId?: string;
  completedRoundsAtStart: number;
}

export interface GaslightPlanState {
  planPath: string;
  archivedPath?: string;
  rounds: GaslightRoundState[];
}

export interface GaslightRoundState {
  round: number;
  prompt: string;
  summary: string;
  threadId?: string;
  usage?: SpawnUsage;
}
```

Default state path:

- Use `.poe-code/gaslight/<fingerprint>.json` for the default file path so `--resume` can find the run without the user remembering a UUID.
- Derive `<fingerprint>` from normalized `cwd`, `agent`, optional `model`, mode, config hash, and ordered plan paths.
- Generate `runId` with `crypto.randomUUID()` when the state file is first created. Preserve that `runId` across all resumes.
- Generate a new `attemptId` with `crypto.randomUUID()` every time `runGaslight` starts. A normal first run records `kind: "initial"`; a resumed invocation records `kind: "resume"` and links `resumedFromAttemptId` to the prior attempt when known.
- Use a structured hash helper, not regex/string scraping.

Checkpoint rules:

- Write initial state before the first spawn, including `runId`, the initial `attemptId`, and `attempts[0]`.
- On every resume, append a new attempt record before the first resumed spawn.
- After every successful spawn result, append the completed round and atomically write state before starting the next round.
- After each successful plan archive, record `archivedPath` and atomically write state.
- After all selected plans finish, mark the current attempt `completed`, emit final run metadata, then delete the active state file. Successful runs must not leave stale resumable state behind.
- Write via temporary sibling file plus rename. If rename is unavailable in an injected filesystem, fail clearly because resumability depends on durable writes.

Resume rules:

- `resume: true` loads the state file and validates agent, model, mode, config hash, prompt sequence, and plan paths.
- The loaded state keeps the original `runId`; resume creates only a new `attemptId`.
- Completed rounds are skipped.
- The next round gets `resumeThreadId` from the last completed round for that plan.
- Already archived completed plans are skipped even though their original plan file no longer exists.
- A failed in-flight round is retried from the last checkpointed completed round.

Spawn resume validation:

- Add a unit-level assertion around `buildSpawnArgs("codex", { resumeThreadId, mode: "edit", useStdin: true })`.
- The expected Codex command shape must keep `-s workspace-write` before the `resume` subcommand when using `codex exec resume`.
- Do not special-case Codex in Gaslight; fix or lock the declarative `agent-spawn` config and argument builder behavior.

## 4. Interfaces and test plan

New and changed interfaces:

```ts
export interface GaslightOptions {
  planPaths: string[];
  agent: string;
  model?: string;
  mode?: Exclude<SpawnMode, "auto">;
  resume?: boolean;
  reset?: boolean;
  statePath?: string;
  stateDir?: string;
  onEvent?: (event: GaslightEvent) => void;
}
```

```ts
export type GaslightEvent =
  | { type: "state.loaded"; statePath: string; runId: string; attemptId: string; completedRounds: number }
  | { type: "state.saved"; statePath: string; runId: string; attemptId: string; completedRounds: number }
  | { type: "state.cleared"; statePath: string; runId: string; attemptId: string }
  | existing round events;
```

CLI flags:

- `--resume`: resume from the resolved state file when present.
- `--reset`: delete the resolved state file before starting.
- `--state-path <path>`: explicit state file.
- `--state-dir <path>`: directory for default state filenames.

Unit tests:

- `packages/agent-gaslight/src/run.test.ts`: checkpoints after every successful round.
- `packages/agent-gaslight/src/run.test.ts`: creates one stable `runId` and a new `attemptId` for a resume.
- `packages/agent-gaslight/src/run.test.ts`: resumes round 2 using round 1's persisted `threadId`.
- `packages/agent-gaslight/src/run.test.ts`: skips an archived first plan and resumes a failed second plan.
- `packages/agent-gaslight/src/run.test.ts`: rejects resume when config hash or plan order differs.
- `packages/agent-gaslight/src/run.test.ts`: `--reset` equivalent starts fresh and removes old state.
- `packages/agent-gaslight/src/run.test.ts`: deletes the state file after the final round and final archive succeed.
- `src/cli/commands/gaslight.test.ts`: forwards `resume`, `reset`, `statePath`, and `stateDir`.
- `src/cli/commands/gaslight.test.ts`: existing state without `--resume` or `--reset` prints the recovery error.
- `packages/agent-spawn/src/configs/configs.test.ts` or `packages/agent-spawn/src/spawn.test.ts`: locks Codex resume argument order with mode flags.

Must-work checklist:

- [ ] Crash after round 1 can resume at round 2.
  Proof: `npx vitest run packages/agent-gaslight/src/run.test.ts -t "resumes round 2"`
- [ ] Resume preserves the original run UUID and records a new resume attempt UUID.
  Proof: `npx vitest run packages/agent-gaslight/src/run.test.ts -t "runId"`
- [ ] Multi-plan resume works after plan 1 was archived.
  Proof: `npx vitest run packages/agent-gaslight/src/run.test.ts -t "skips an archived first plan"`
- [ ] Stale or mismatched state cannot accidentally drive a different run.
  Proof: `npx vitest run packages/agent-gaslight/src/run.test.ts -t "rejects resume"`
- [ ] CLI exposes the resume/reset flags and forwards them to the SDK.
  Proof: `npx vitest run src/cli/commands/gaslight.test.ts`
- [ ] Successful Gaslight completion removes the state file.
  Proof: `npx vitest run packages/agent-gaslight/src/run.test.ts -t "deletes the state file"`
- [ ] Codex resume argv keeps mode options in a valid position.
  Proof: `npx vitest run packages/agent-spawn/src/configs/configs.test.ts -t "codex"`
- [ ] CLI help remains readable.
  Proof: `npm run screenshot-poe-code -- gaslight --help`

Real-world test:

1. Create a temporary plan and a temporary Gaslight config with at least two follow-ups.
2. Run a controlled test spawn or dry test harness that returns `threadId: "thread-one"` for round 1 and then throws before round 2.
3. Confirm `.poe-code/gaslight/<fingerprint>.json` contains round 1, `thread-one`, one `runId`, and the initial attempt UUID.
4. Rerun with `--resume`.
5. Confirm the next spawn receives `resumeThreadId: "thread-one"`, the first prompt is not executed again, `runId` is unchanged, and a second attempt UUID was appended.

## 5. Code plan

Files to create:

- `packages/agent-gaslight/src/state.ts`: state path resolution, UUID generation, schema validation, stable fingerprint hashing, atomic read/write/remove helpers.
- `packages/agent-gaslight/src/state.test.ts`: focused `memfs` coverage for state validation and atomic write behavior if this grows beyond `run.test.ts`.

Files to change:

- `packages/agent-gaslight/src/types.ts`: add state/resume options, events, and exported state types.
- `packages/agent-gaslight/src/run.ts`: integrate state load/save/clear into the existing plan and round loops.
- `packages/agent-gaslight/src/run.test.ts`: add resume-first TDD coverage before implementation.
- `src/cli/commands/gaslight.ts`: add `--resume`, `--reset`, `--state-path`, `--state-dir`, forward SDK options, and print state events.
- `src/cli/commands/gaslight.test.ts`: cover CLI flag forwarding and stale-state behavior.
- `packages/agent-spawn/src/spawn.test.ts`: lock the generated Codex resume command shape when `resumeThreadId` and mode flags coexist.
- `packages/agent-gaslight/README.md`: update only after explicit user permission.

Build order:

1. Add failing `agent-gaslight` tests for completed-round resume and multi-plan archived resume.
2. Implement `state.ts` with stable `runId` and per-invocation `attemptId`, then integrate checkpoint writes into `runGaslight`.
3. Add mismatch/reset tests and implement validation/clear behavior.
4. Add CLI tests and flags.
5. Add Codex resume argv regression test; fix `agent-spawn` only if the test exposes the bad `-s` placement.
6. Run targeted tests, package typechecks, `git diff --check`, and the gaslight help screenshot.
