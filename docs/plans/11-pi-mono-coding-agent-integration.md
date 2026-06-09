---
kind: superintendent
version: 1

builder:
  agent: claude-code
  prompt: |
    Implement the highest-priority open task from {{plan.path}}. Tests before code.

inspectors:
  spawn-parity:
    agent: claude-code
    prompt: |
      Compare the new `pi-mono` config against the other entries in `packages/agent-spawn/src/configs/` — mode matrix, flag shapes, stdin mode, registry wiring, tests. Flag any parity gap.

  configure-path:
    agent: claude-code
    prompt: |
      Run `poe-code configure --agent pi-mono` in both prompted and `--yes` form and confirm it writes `~/.pi/agent/settings.json` + credential storage with the POE OpenAI-compat endpoint. Reject if it prompts when `--yes` is passed.

  live-spawn:
    agent: claude-code
    prompt: |
      Run `npm run dev -- spawn --agent pi-mono --prompt "say hi"`. Confirm tokens stream and the process exits 0. Capture any stderr and attach.

superintendent:
  agent: claude-code
  prompt: |
    Review builder and inspector output, update the Task Board in {{plan.path}}, and hand to owner only when every task is checked and every inspector accepted.

    Builder summary:
    {{builder.summary}}

    Inspector summaries:

    ## spawn parity
    {{inspectors.spawn-parity}}

    ## configure path
    {{inspectors.configure-path}}

    ## live spawn
    {{inspectors.live-spawn}}

owner:
  agent: claude-code
  prompt: |
    Approve or send back based on {{superintendent.summary}}. Reject if any Task Board item is open, any inspector is red, or new code lacks tests.

max_rounds: 100

status:
  state: build
  round: 0
  review_turn: 0
---

# pi-mono coding-agent — Integration

## Summary

Add `pi-mono` as a first-class agent in poe-code: declare it in `@poe-code/agent-defs`, wire its CLI into `@poe-code/agent-spawn`, and teach `poe-code configure --agent pi-mono` to set up an OpenAI-compatible provider pointed at Poe using the user's API key.

## 1. Goals

- `poe-code configure --agent pi-mono` walks the user through model + API-key setup and writes pi-mono's own `~/.pi/agent/settings.json` so `pi "..."` works against Poe out of the box.
- `poe-code spawn --agent pi-mono --prompt "..."` spawns pi-mono's CLI with prompt streaming parity against codex / opencode.
- pi-mono appears in the interactive `configure` agent picker and in `--help`, alongside existing agents.

## 2. Non-goals

- Porting pi-mono tools, hooks, extensions, slash commands, or MCP semantics into `@poe-code/poe-agent`.
- Embedding pi-mono's runtime in-process.
- Introducing a provider abstraction inside `@poe-code/poe-agent`.
- Session JSONL / fork / tree / RPC-mode parity.
- Bun-compiled binary distribution — we assume the npm-installed `pi` binary is on `PATH`.

## 3. Decisions (locked)

- **Runtime**: spawn pi-mono's published `pi` CLI as an external process, following [packages/agent-spawn/src/configs/codex.ts](packages/agent-spawn/src/configs/codex.ts) / [packages/agent-spawn/src/configs/opencode.ts](packages/agent-spawn/src/configs/opencode.ts). No ACP adapter in v1 — text-mode streaming only.
- **Provider / auth**: use pi-mono's built-in `openai-completions` wire protocol pointed at `https://api.poe.com/v1` (the same base `@poe-code/poe-code-config` already defines via `POE_BASE_URL`). The user's `POE_API_KEY` is reused — no new credential store.
- **Install expectation**: `pi` must be on `PATH`. Detection reuses the same `binaryName` convention as codex / opencode in `@poe-code/agent-defs`.

## 4. Surface changes

### New files

- [packages/agent-defs/src/agents/pi-mono.ts](packages/agent-defs/src/agents/pi-mono.ts) — `AgentDefinition` with `id: "pi-mono"`, `binaryName: "pi"`, `configPath: "~/.pi/agent/settings.json"`, branding. Model after [packages/agent-defs/src/agents/codex.ts](packages/agent-defs/src/agents/codex.ts).
- `packages/agent-defs/src/agents/pi-mono.test.ts` — resolves id + alias (`pi`), validates metadata shape.
- [packages/agent-spawn/src/configs/pi-mono.ts](packages/agent-spawn/src/configs/pi-mono.ts) — `CliSpawnConfig` declaring `promptFlag: "-p"` (print mode), `modelFlag: "--model"`, `defaultArgs` for machine-readable output (`--json` where pi-mono supports it), mode matrix, stdin mode. No MCP — pi-mono has no MCP concept.
- `packages/agent-spawn/src/configs/pi-mono.test.ts` — snapshot arg vectors for print, json, yolo/edit/read modes, model flag on/off, stdin mode.

### Modified files

- [packages/agent-defs/src/agents/index.ts](packages/agent-defs/src/agents/index.ts) — export `piMonoAgent`.
- [packages/agent-spawn/src/configs/index.ts](packages/agent-spawn/src/configs/index.ts) — add `piMonoSpawnConfig` to `allSpawnConfigs`.
- [src/cli/commands/configure.ts](src/cli/commands/configure.ts) — add pi-mono to the picker; on selection, prompt for model + API key (reusing the existing POE API-key path), then write `~/.pi/agent/settings.json` with `defaultProvider` wired to Poe's OpenAI-compat endpoint.
- Each touched package README — add pi-mono to the supported-agents list.

### Untouched (guard-rail)

- `packages/poe-agent/**` — out of scope. That package's alignment with pi-mono is the discovery-side concern, not this integration.
- `packages/toolcraft*/**`, `packages/toolcraft-design/**` — consumed, not modified.

## 5. Test plan (TDD, per CLAUDE.md)

1. `agent-defs/src/agents/pi-mono.test.ts` — id + alias resolution, metadata shape.
2. `agent-spawn/src/configs/pi-mono.test.ts` — arg-vector snapshots across every mode combination listed above.
3. Extend [packages/agent-spawn/src/configs/configs.test.ts](packages/agent-spawn/src/configs/configs.test.ts) so the registry lookup + `supportsMcpAtSpawn("pi-mono") === false` are asserted.
4. Configure-flow unit test using `memfs` — `poe-code configure --agent pi-mono --model <m> --yes` writes the expected `settings.json` and does not prompt. Assert the provider block points at `https://api.poe.com/v1`.
5. Spot-tests (not CI):
   - `npm run dev -- configure --agent pi-mono`
   - `npm run dev -- configure --agent pi-mono --yes`
   - `npm run dev -- spawn --agent pi-mono --prompt "say hi"`
   - `npm run screenshot-poe-code -- configure` (visual check that pi-mono appears in the picker with correct branding)

## 6. Task Board

- [ ] Add `piMonoAgent` + tests in `@poe-code/agent-defs`; export from the barrel.
- [ ] Add `piMonoSpawnConfig` + tests in `@poe-code/agent-spawn`; register in `allSpawnConfigs`; extend `configs.test.ts`.
- [ ] Extend `poe-code configure` to offer pi-mono, prompt for model + API key, and write `~/.pi/agent/settings.json` pointing at `https://api.poe.com/v1`. Cover with a `memfs`-backed unit test.
- [ ] Verify `poe-code configure --agent pi-mono --yes` accepts defaults and never prompts.
- [ ] Spot-test `spawn --agent pi-mono --prompt "..."`; confirm streaming, exit code 0.
- [ ] Run `npm run screenshot-poe-code -- configure`; confirm pi-mono renders in the picker with intended branding.
- [ ] Update READMEs for `agent-defs`, `agent-spawn`, and the top-level poe-code supported-agents list.

## 7. Deferred (explicitly out of v1)

- **ACP adapter for pi-mono** — its NDJSON shape matches none of the existing adapters. Decide in a follow-up whether to write one or keep pi-mono spawn-only.
- **Session / fork / tree continuity** — pi-mono owns `~/.pi/agent/sessions/*.jsonl`; cross-invocation continuity from poe-code is future work.
- **MCP surface** — pi-mono has no MCP concept; leave `mcpArgs` / `mcpEnv` unset. Revisit only with a concrete use case.
- **Managed fd / rg binaries** — pi-mono can self-download these to `~/.pi/agent/bin`. Not a poe-code concern unless we lock down egress in CI.
- **Provider abstraction inside `poe-agent`** — tracked separately; this plan does not touch `@poe-code/poe-agent`.

## References

- Sibling spawn configs: [packages/agent-spawn/src/configs/](packages/agent-spawn/src/configs/).
- Sibling agent defs: [packages/agent-defs/src/agents/](packages/agent-defs/src/agents/).
- Configure entry point: [src/cli/commands/configure.ts](src/cli/commands/configure.ts).
