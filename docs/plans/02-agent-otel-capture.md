---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Agent OTel capture alongside ACP

Capture OpenTelemetry traces emitted by spawned agents and merge their per-LLM-call detail into the ACP `_meta` channel so it flows through to the Braintrust bridge.

## 1. What we're building

Capture OpenTelemetry from spawned agents alongside the existing ACP event stream, and merge the OTel data into the ACP `_meta` channel so it flows through to the Braintrust bridge.

The motivation is per-LLM-call fidelity in Braintrust — model identity, model params (temperature, top_p, max_tokens, system prompt), per-call prompt/completion/cached tokens, per-call cost, per-call latency. ACP cannot carry this layer because it is outside the protocol's scope; the agent's own OTel spans, log events, and metrics can.

OTel runs alongside ACP, joined by per-spawn correlation. Each spawn opens a private in-process OTLP/HTTP receiver, configures the agent process to export to that receiver, and folds collected spans into the ACP event stream's `_meta` before events are emitted to consumers. Existing `_meta` plumbing in [span-builder.ts](packages/braintrust/src/span-builder.ts) carries the data into Braintrust without further changes.

### Per-agent reality

Verified by reading source / strings on installed binaries 2026-05-05.

| Agent | OTel | Activation | Per-LLM-call detail | Cost | Notes |
| --- | --- | --- | --- | --- | --- |
| claude-code 2.1.128 | yes | `CLAUDE_CODE_ENABLE_TELEMETRY=1` + standard `OTEL_*` env | span `claude_code.llm_request` and log event `api_request` | yes (event only) | Need logs exporter, not just traces, to get cost |
| codex 0.125.0 | yes | TOML `[otel] exporter = "otlp_http"` in `~/.codex/config.toml` + `OTEL_EXPORTER_OTLP_ENDPOINT` | span `codex.api_request` + `codex.sse_event` | derive | Force-disable Statsig exporter; honors `TRACEPARENT` |
| opencode | yes | config `experimental.openTelemetry: true` + `OTEL_EXPORTER_OTLP_ENDPOINT` | span `ai.streamText.doStream` (Vercel AI SDK) | derive | OTLP/HTTP only; stamps `session.id` per span |
| goose 1.29.x | yes | `OTEL_EXPORTER_OTLP_ENDPOINT` (any signal) | span `complete` per call (model + latency) | derive | Tokens not on spans; live in goose session SQLite |
| kimi 1.37.0 | no | n/a | n/a | n/a | Excluded day-one |
| poe-agent | no (own code) | n/a | n/a | n/a | Separate workstream |

### Non-goals

- Replacing ACP. OTel is additive.
- Cross-spawn correlation. Each spawn is a self-contained trace context.
- Routing OTel to non-Braintrust backends. Sink is in-process; data reaches Braintrust via existing `_meta` plumbing.
- Instrumenting agents that don't emit OTel today (kimi, poe-agent). Those keep current ACP-only fidelity until we add OTel ourselves separately.
- Capturing OTel logs/metrics outside the per-LLM-call surface (cost, tokens, latency, model). We ignore unrelated agent-internal telemetry (host metrics, hook timings, MCP connection events).

## 2. User-facing shape

### Default off, opt-in three ways

```bash
# CLI flag
poe-code spawn codex "fix the failing test" --capture-otel

# Env var (covers SDK and CLI)
POE_CODE_CAPTURE_OTEL=1 poe-code spawn codex "..."

# SDK option
spawn("codex").captureOtel().run("...")
```

When the flag is set but the chosen agent doesn't emit OTel (kimi, poe-agent), poe-code prints one warning to stderr and proceeds without OTel. The spawn does not fail.

```text
$ poe-code spawn kimi "..." --capture-otel
warning: agent "kimi" does not emit OpenTelemetry; running without OTel capture
```

### What lands in Braintrust

For an OTel-supporting agent, Braintrust spans gain a `metadata.llm` array — one entry per LLM API call observed during the spawn — under the existing agent task span:

```jsonc
{
  "name": "agent:codex:gpt-5",
  "type": "task",
  "metadata": {
    "sessionId": "...",
    "threadId": "...",
    "llm": [
      {
        "model": "gpt-5",
        "provider": "openai",
        "inputTokens": 1432,
        "outputTokens": 287,
        "cachedTokens": 800,
        "cacheCreationTokens": 0,
        "reasoningTokens": 64,
        "durationMs": 2341,
        "ttftMs": 612,
        "costUsd": 0.0184,
        "requestId": "req_abc123",
        "finishReason": "stop",
        "attempt": 1,
        "params": { "temperature": 1.0, "topP": 1.0, "maxTokens": 4096 }
      }
    ]
  }
}
```

Tool spans gain `metadata.tool.durationMs` when the agent emitted a tool span. Fields not provided by the agent (e.g. `costUsd` on codex/opencode/goose, `params` on most) are computed where derivable (cost from a model-price table) or omitted.

### CLI verbose output

`--capture-otel --verbose` prints a one-line summary at run end:

```text
otel: 7 LLM calls captured (gpt-5: 7), 14210 tokens, 0.087 USD, 18.4s
```

### Configuration

Per-agent capability lives in agent-defs. `agent.otelCapture` is one of:

- `undefined` — agent has no OTel; flag becomes no-op.
- `{ kind: "env", env: {...}, traceparent?: boolean }` — set env vars on spawn (claude-code, goose).
- `{ kind: "config-overlay", strategy: "toml" | "json", path: string, merge: ... }` — write/merge per-agent config to enable, plus env vars (codex, opencode).

The user does not edit agent configs by hand. poe-code writes a per-spawn overlay (temp file) and points the agent at it via the agent's existing config flag.

### Privacy

Default capture excludes prompt and response bodies. To capture them, the user opts in further:

```bash
poe-code spawn claude --capture-otel --capture-otel-content
```

This sets `OTEL_LOG_USER_PROMPTS=1`, `OTEL_LOG_TOOL_CONTENT=1`, `OTEL_LOG_TOOL_DETAILS=1` for claude-code and equivalents elsewhere. Existing `redact()` in [span-builder.ts](packages/braintrust/src/span-builder.ts) still runs on whatever lands in `_meta`.

## 3. Implementation details and technical decisions

### New package: `@poe-code/otel-capture`

Lives at `packages/otel-capture/`. Owns:

- In-process OTLP/HTTP receiver (uses `node:http`, no third-party SDK).
- Per-spawn buffer keyed by `poe.session_id` resource attribute.
- Per-agent normalizer (claude / codex / opencode / goose), each a plain function `OtlpResourceSpans -> NormalizedLlmCall[]`.
- Cost lookup table (`packages/otel-capture/src/pricing.ts`) — model id → usd-per-1M-input/output/cache. Used for codex/opencode/goose; claude-code reads cost from its own `api_request` log event.
- Public API: `startCapture({ sessionId, agentId }) -> { endpoint, getEnv, drain }`.

This package has no dependency on `agent-spawn` or `braintrust`; it's a leaf the spawn boundary calls into.

### Sink topology: in-process OTLP/HTTP receiver

- One `node:http` server bound to `127.0.0.1:0` (kernel-assigned port) per spawn. Spawn destroys it on completion.
- Accepts OTLP/HTTP `POST /v1/traces`, `POST /v1/logs`, `POST /v1/metrics` (claude-code emits all three; we need traces+logs for cost on claude).
- Decodes `application/x-protobuf` and `application/json`. We avoid pulling `@opentelemetry/sdk-*` runtime deps; we bundle the OTLP `.proto` schema and use `protobufjs` (already in repo) for decoding.
- Indexes spans/logs/metrics by their `poe.session_id` resource attribute. Records that lack it are dropped (we don't relay other processes' OTel).

Why in-process and not OTLP-to-Braintrust direct: keeps the per-spawn data joinable to the ACP event before the bridge runs, avoids requiring Braintrust credentials in the agent process, makes offline replay self-contained.

### Per-agent activation

Each agent def grows an `otelCapture` field. Spawn boundary reads it and applies.

**claude-code** — env-only:

```ts
{
  kind: "env",
  env: {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,           // from receiver
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
    OTEL_TRACES_EXPORTER: "otlp",
    OTEL_LOGS_EXPORTER: "otlp",                      // required for cost
    OTEL_METRICS_EXPORTER: "none",                   // we don't need metrics
    OTEL_RESOURCE_ATTRIBUTES: `poe.session.id=${sessionId}`,
  }
}
```

Optional content-capture env (under `--capture-otel-content`): `OTEL_LOG_USER_PROMPTS=1`, `OTEL_LOG_TOOL_CONTENT=1`, `OTEL_LOG_TOOL_DETAILS=1`.

**codex** — config-overlay + env:

- Overlay strategy: write a temp TOML file containing only the `[otel]` block, merge with user's `~/.codex/config.toml` via codex's existing `--config` flag (codex supports `--config key=value` overrides; if the version installed lacks a `--config-file` equivalent, we write a sidecar in `$CODEX_HOME` and clean it up).
- Force `[otel] exporter = "otlp_http"` (never `statsig`), `trace_exporter = "otlp_http"`, `metrics_exporter = "none"`.
- Env: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, `OTEL_RESOURCE_ATTRIBUTES=poe.session.id=...`, `TRACEPARENT=<W3C from outer span if present>`.

**opencode** — config-overlay + env:

- Overlay strategy: opencode reads JSON config from `OPENCODE_CONFIG` env or default location. Write per-spawn JSON containing `{ experimental: { openTelemetry: true } }` merged with user config; point `OPENCODE_CONFIG` at it.
- Env: `OTEL_EXPORTER_OTLP_ENDPOINT=<receiver>/v1/traces` (opencode hardcodes `/v1/traces` suffix; we expose the bare host:port and accept both shapes server-side).
- Resource attribute injection happens via opencode's per-span `session.id` automatically; we still set `OTEL_RESOURCE_ATTRIBUTES` as a safety net.

**goose** — env-only:

```ts
{
  kind: "env",
  env: {
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
    OTEL_RESOURCE_ATTRIBUTES: `poe.session.id=${sessionId}`,
    OTEL_METRICS_EXPORTER: "none",
    OTEL_LOGS_EXPORTER: "none",
  }
}
```

Goose tokens are not on spans. Day-one normalizer for goose returns model + latency only; tokens stay sourced from the existing stream parser. Out of scope: scraping goose's session SQLite. Filing an upstream PR to add `gen_ai.usage.*` to the `complete` span is the durable path and tracked separately.

### Correlation

`poe.session.id` resource attribute is the join key. Receiver indexes by it. Every normalizer reads it. Spans without `poe.session.id` are dropped to prevent cross-spawn bleed.

For codex and goose, we also propagate `TRACEPARENT` (W3C) from any outer poe-code span, so per-LLM-call spans nest correctly under a future poe-code parent. Opencode does not appear to propagate W3C in/out; we accept this and treat its session.id-keyed spans as orphans under the agent task span.

### Per-agent normalizer

Each is a pure function. Returns `NormalizedLlmCall[]`. The shape:

```ts
type NormalizedLlmCall = {
  model: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
  durationMs?: number;
  ttftMs?: number;
  costUsd?: number;
  requestId?: string;
  finishReason?: string;
  attempt?: number;
  params?: { temperature?: number; topP?: number; maxTokens?: number };
};
```

Mappings (verified attribute names per agent):

- **claude-code**: span `claude_code.llm_request` → most fields. Cost from log event `claude_code.api_request` (`cost_usd`). Match span↔event by `request_id` / `client_request_id`.
- **codex**: span `codex.api_request` (`duration_ms`, `model`, `attempt`) + child `codex.sse_event` for `response.completed` carrying `input_token_count` etc. Cost derived from pricing table.
- **opencode**: span `ai.streamText.doStream` — read GenAI semconv (`gen_ai.usage.input_tokens` etc.) and AI SDK custom (`ai.response.msToFirstChunk` for TTFT, `ai.response.msToFinish` for duration, `ai.usage.cachedInputTokens`, `ai.usage.outputTokenDetails.reasoningTokens`). Cost derived.
- **goose**: span `complete` — `gen_ai.request.model`, span duration. No tokens. Cost derived from pricing table once tokens are joined from the stream parser (deferred — day-one goose entries are model+latency only).

### Drain & merge

When the spawn's events stream ends, the spawn boundary calls `capture.drain()`:

1. Receiver has a 2-second post-completion grace period to ingest any in-flight exports (BSP flush windows differ per agent: ~5s default but agents shutdown-flush on SIGTERM).
2. Normalizer runs, producing `NormalizedLlmCall[]`.
3. List is attached to the next-emitted spawn-result event's `_meta.llm`. Per-tool LLM calls (where the OTel span was a child of a tool execution span) are folded into the corresponding `tool_call_update`'s `_meta.llm` instead.

This piggybacks on the `_meta` → Braintrust span metadata plumbing already shipped in [span-builder.ts](packages/braintrust/src/span-builder.ts). No bridge changes required.

### Failure modes

- Agent OTel export fails (e.g. SIGKILL before flush): receiver returns whatever it captured. `_meta.llm` may be partial. No spawn failure.
- Receiver bind fails (port exhaustion): warning, spawn proceeds without OTel. No spawn failure.
- Normalizer throws on unexpected attribute shape: caught, recorded once via `BraintrustClient.recordError`-equivalent, spawn proceeds.
- User-supplied `OTEL_EXPORTER_OTLP_ENDPOINT` already in env: refuse to override; warn that user's collector takes precedence and our capture is disabled for this spawn.

### Edge cases

- Multiple agents spawned concurrently: each spawn has its own receiver on a different port. Resource-attr `poe.session.id` keeps streams separated even if a misconfigured agent fans out.
- Detached spawns (e2b/docker runtime): receiver is in the host poe-code process; agent in a container needs to reach it. Day-one only support `runtime: "host"` for `--capture-otel`. Document that detached + capture is unsupported and emit a warning.
- Agent updates that change span/attribute names: the normalizer's the only thing to update. Each agent's pinned version of attribute names is documented in inline comments referencing the source files we read.

### Flags and env vars

Default-on: none of the new flags. All opt-in.

| Flag | Env | SDK | Default | Purpose |
| --- | --- | --- | --- | --- |
| `--capture-otel` | `POE_CODE_CAPTURE_OTEL=1` | `.captureOtel()` | off | Master switch |
| `--capture-otel-content` | `POE_CODE_CAPTURE_OTEL_CONTENT=1` | `.captureOtel({ content: true })` | off | Include prompt/response bodies |

## 4. Interfaces and test plan

### Module-boundary types

`packages/otel-capture/src/index.ts`:

```ts
export interface CaptureOptions {
  sessionId: string;
  agentId: string;
  captureContent?: boolean;
}

export interface CaptureHandle {
  endpoint: string;            // e.g. "http://127.0.0.1:54321"
  getEnv(): Record<string, string>;
  getConfigOverlay(): ConfigOverlay | undefined;
  drain(): Promise<NormalizedLlmCall[]>;
  close(): Promise<void>;
}

export interface ConfigOverlay {
  format: "toml" | "json";
  path: string;                // temp file written by the package
  cliArgs?: string[];          // e.g. ["--config", path] to append to spawn argv
}

export type NormalizedLlmCall = { /* as in level 3 */ };

export function startCapture(opts: CaptureOptions): Promise<CaptureHandle>;
```

`packages/agent-defs/src/types.ts` — extend `AgentDefinition`:

```ts
otelCapture?:
  | { kind: "env"; env: (ctx: OtelCtx) => Record<string, string>; traceparent?: boolean }
  | { kind: "config-overlay"; strategy: "toml" | "json"; build: (ctx: OtelCtx) => ConfigOverlayInput };
```

`OtelCtx = { sessionId: string; endpoint: string; captureContent: boolean; traceparent?: string }`.

`packages/agent-spawn/src/types.ts` — extend `SpawnOptions`:

```ts
captureOtel?: boolean;
captureOtelContent?: boolean;
```

### Tests

Unit tests, per package (vitest, fast — must use `memfs` for any temp file work per [CLAUDE.md](CLAUDE.md)):

- `otel-capture/normalizers/claude.test.ts` — feed a recorded OTLP/HTTP body (saved as fixture proto bytes) to the normalizer. Assert exact `NormalizedLlmCall[]`.
- Same for codex, opencode, goose. Each normalizer gets one happy-path fixture and one degenerate (missing optional fields).
- `otel-capture/receiver.test.ts` — start receiver, POST a fixture protobuf, read drain output. Verify `poe.session.id` filtering drops cross-session records.
- `otel-capture/pricing.test.ts` — known model → expected cost derivation.
- `agent-spawn/spawn.otel.test.ts` — spawn with `captureOtel: true`, mock child process emits no OTel, drain returns empty array, `_meta.llm` is omitted (not set to `[]`).
- `agent-spawn/spawn-acp.otel.test.ts` — same, ACP path.

Integration tests:

- `e2e/otel-capture.test.ts` — for each in-scope agent, spawn a real binary with `--capture-otel` against a trivial prompt. Assert at least one `_meta.llm` entry appears with `model`, `inputTokens`, `outputTokens`. Tagged `e2e:` so it's excluded from `npm test:unit`. Skipped in CI without agent binaries; runs locally and on a self-hosted runner.

### Manual QA

QA plan lives at `docs/plans/qa/agent-otel-capture.md` per [CLAUDE.md](CLAUDE.md).

- Run a real prompt against each in-scope agent. Open the corresponding Braintrust trace and verify per-LLM-call rows show model, tokens, latency, cost (where derived). Document a screenshot per agent.

### Rollout

- Behind opt-in flag from day one. No migration of existing callers.
- Document in [packages/otel-capture/README.md](packages/otel-capture/README.md) and the spawn package readme: env vars exposed, opt-in cost, privacy implications of `--capture-otel-content`.

### Autonomy checklist

An executor working from this plan should be able to:

- Build the `otel-capture` package without touching Braintrust or spawn — receiver + normalizers + pricing + tests.
- Wire `agent-defs` `otelCapture` field for the four in-scope agents. Each requires reading two specific upstream source files (cited in level 3); the executor records the pinned version they verified against.
- Wire spawn boundary in `spawn.ts` and `spawn-acp.ts` after the package and agent-defs are ready.
- Recompute cost for codex/opencode/goose from a static pricing table; if a model is unknown to the table, omit `costUsd` (do not fail).
- Skip kimi and poe-agent. Don't add `otelCapture` to their defs.

## 5. Code plan

### Files to create

- `packages/otel-capture/package.json` — name `@poe-code/otel-capture`, deps `protobufjs` only (no OTel SDK).
- `packages/otel-capture/README.md` — env vars, options, privacy notes (added per CLAUDE.md package rules).
- `packages/otel-capture/src/index.ts` — barrel.
- `packages/otel-capture/src/types.ts` — `CaptureOptions`, `CaptureHandle`, `NormalizedLlmCall`, `ConfigOverlay`.
- `packages/otel-capture/src/receiver.ts` — `node:http` server, OTLP `/v1/traces|/v1/logs|/v1/metrics`, indexes by `poe.session.id`.
- `packages/otel-capture/src/proto.ts` — protobuf decoder loaded from bundled OTLP `.proto`.
- `packages/otel-capture/src/normalizers/claude.ts` — span+log → `NormalizedLlmCall[]`.
- `packages/otel-capture/src/normalizers/codex.ts`
- `packages/otel-capture/src/normalizers/opencode.ts`
- `packages/otel-capture/src/normalizers/goose.ts`
- `packages/otel-capture/src/normalizers/index.ts` — `getNormalizer(agentId)`.
- `packages/otel-capture/src/pricing.ts` — `costUsd(model, usage)`.
- `packages/otel-capture/src/start-capture.ts` — `startCapture(opts) -> CaptureHandle`.
- Tests collocated: `*.test.ts` next to each module + fixtures under `__fixtures__/otlp-*.bin`.
- `docs/plans/qa/agent-otel-capture.md` — per-agent manual QA checklist.

### Files to change

- `packages/agent-defs/src/types.ts` — add `otelCapture` to `AgentDefinition`.
- `packages/agent-defs/src/agents/claude-code.ts` — `otelCapture: envBased(...)`.
- `packages/agent-defs/src/agents/codex.ts` — `otelCapture: configOverlay({ strategy: "toml", ... })`.
- `packages/agent-defs/src/agents/opencode.ts` — `otelCapture: configOverlay({ strategy: "json", ... })`.
- `packages/agent-defs/src/agents/goose.ts` — `otelCapture: envBased(...)`.
- `packages/agent-spawn/src/types.ts` — add `captureOtel?: boolean`, `captureOtelContent?: boolean` to `SpawnOptions`.
- `packages/agent-spawn/src/acp/spawn.ts` — at top of `spawnStreaming`, if `options.captureOtel` and agent has `otelCapture`, call `startCapture`, merge env into spawn env, append `cliArgs` from overlay, drain on `done`, push the resulting calls into the final event's `_meta.llm`.
- `packages/agent-spawn/src/acp/spawn-acp.ts` — same pattern around `spawnAcp`.
- `src/cli/commands/spawn.ts` — add `--capture-otel` and `--capture-otel-content` flags, thread to SDK.
- `packages/agent-spawn/src/sdk.ts` (or wherever the fluent builder lives — `spawn-hooks.md` plan referenced this) — add `.captureOtel(opts?)`.
- `packages/braintrust/src/span-builder.ts` — extend `collectToolMeta` and the agent-span metadata path to surface `_meta.llm` as nested `metadata.llm` on the Braintrust span. Existing plumbing already merges arbitrary `_meta` keys, so this may need only a smoke test to confirm `llm` (an array) survives the merge.

### Signatures for new/modified functions

```ts
// packages/otel-capture/src/start-capture.ts
export async function startCapture(opts: CaptureOptions): Promise<CaptureHandle>;

// packages/otel-capture/src/receiver.ts
export interface OtlpReceiver {
  endpoint: string;
  drain(sessionId: string): { spans: ResourceSpan[]; logs: ResourceLog[]; metrics: ResourceMetric[] };
  close(): Promise<void>;
}
export function createReceiver(): Promise<OtlpReceiver>;

// packages/otel-capture/src/normalizers/<agent>.ts
export function normalize<Agent>(input: { spans: ResourceSpan[]; logs: ResourceLog[] }): NormalizedLlmCall[];

// packages/otel-capture/src/pricing.ts
export function costUsd(model: string, usage: Pick<NormalizedLlmCall, "inputTokens" | "outputTokens" | "cachedTokens">): number | undefined;

// packages/agent-spawn/src/acp/spawn.ts (modified)
function applyOtelCapture(options: SpawnStreamingOptions, agent: AgentDefinition): Promise<{ envExtra: Record<string, string>; argvExtra: string[]; drain: () => Promise<NormalizedLlmCall[]> } | undefined>;
```

### Build order (keeps the branch green at every step)

1. `packages/otel-capture` skeleton + types + receiver + protobuf decoder + tests (ships green; no consumers yet).
2. Per-agent normalizers + fixtures + tests, one PR per agent (claude → codex → opencode → goose).
3. Pricing table + tests.
4. `start-capture` orchestrator + tests.
5. `agent-defs` `otelCapture` field plumbing for the four agents.
6. `agent-spawn` `SpawnOptions.captureOtel` + boundary integration (spawn.ts, spawn-acp.ts) + tests.
7. CLI flag wiring + SDK builder method + tests.
8. Manual QA pass per [docs/plans/qa/agent-otel-capture.md](docs/plans/qa/agent-otel-capture.md), capture screenshots, mark plan complete.
