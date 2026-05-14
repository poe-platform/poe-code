---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: spawn-options-middlewares
    title: Add middlewares to SpawnOptions and wire applyMiddlewares in spawn entry
      points
    prompt: |
      Make middleware a first-class SDK option on `@poe-code/agent-spawn` so
      external callers can register ACP middleware declaratively.

      1. In `packages/agent-spawn/src/types.ts`, add to `SpawnOptions`:

         ```ts
         middlewares?: AcpMiddleware[];
         ```

         Import the type from `./acp/middleware.js`. No other field changes.
         Existing callers must not break.

      2. In `packages/agent-spawn/src/acp/spawn.ts` (`spawnStreaming`) and
         `packages/agent-spawn/src/acp/spawn-acp.ts` (`spawnAcp`), wrap the
         per-session run with `applyMiddlewares(opts.middlewares ?? [], ctx)`
         from `./middleware.js`. The middleware chain calls `next()` to reach
         the existing session body, and the `SpawnContext` (sessionId, agent,
         events, usage, threadId, prompt, model, mode, cwd, startedAt) must
         be populated before middlewares observe it on the way out — match
         the field order used today by `sessionCapture`, `usageCapture`, and
         `spawnLog` in `packages/agent-spawn/src/acp/middlewares/`.

      3. Remove the CLI-side bespoke `applyMiddlewares` arrangement so there
         is one mechanism end-to-end. In `src/cli/commands/spawn.ts` around
         lines 208-210, keep forwarding `middlewares` into the spawn options,
         but stop the handler from calling `applyMiddlewares` itself — the
         SDK now does it. Apply the same simplification in
         `src/cli/commands/pipeline.ts` (lines 594, 932) and
         `src/cli/commands/experiment.ts` (lines 383, 756). The CLI just
         forwards `middlewares: integrations.spawnMiddleware ? [integrations.spawnMiddleware] : undefined`
         into the spawn call.

      4. Add a unit test in `packages/agent-spawn/src/acp/acp.test.ts` (or
         a sibling spec) that calls `spawnStreaming` with a recording
         middleware and asserts onion order plus that `ctx.events` and
         `ctx.usage` are populated by the time the middleware sees them on
         the way out.

      Out of scope: do not move any Braintrust code yet, do not touch
      `@poe-code/braintrust`, do not introduce `@poe-code/acp-telemetry`.

      Acceptance: `npm run build` passes; `npm run test:unit` for
      `packages/agent-spawn` passes; existing CLI behavior unchanged when
      Braintrust is configured.
    status:
      implement: done
      test: done
      commit: done

  - id: acp-telemetry-scaffold
    title: Scaffold @poe-code/acp-telemetry package
    prompt: |
      Create a new workspace package `@poe-code/acp-telemetry` that will hold
      pure ACP → trace converters and SDK-agnostic emitters.

      Files to create under `packages/acp-telemetry/`:

      - `package.json` — name `@poe-code/acp-telemetry`, `private: true`,
        `type: "module"`, `main: "dist/index.js"`, `types: "dist/index.d.ts"`,
        same `exports` shape as `packages/braintrust/package.json`. Scripts:
        `build` (`rm -rf dist && tsc`), `test` and `test:unit` mirroring the
        braintrust package. Dependencies: `"@poe-code/agent-spawn": "*"`.
        DevDependencies: `"vitest": "^4.0.18"`. No `braintrust`, no
        `@opentelemetry/*`.
      - `tsconfig.json` — copy from `packages/braintrust/tsconfig.json`.
      - `README.md` — short: name, purpose ("pure ACP → trace converters
        plus Braintrust/OTEL emitters"), public exports list, "no env vars,
        no config".
      - `src/index.ts` — empty for now (`export {};`).

      Register the package in the root `tsconfig.json` path mapping and any
      root `package.json` workspaces list if the repo lists packages
      explicitly. Run `npm install` so the workspace links resolve.

      Acceptance: `npm run build` passes at repo root; the package shows up
      in `npm ls --workspaces` (or equivalent for the repo's workspace tool).
    status:
      implement: done
      commit: done

  - id: move-redact-to-telemetry
    title: Move redact.ts from @poe-code/braintrust to @poe-code/acp-telemetry
    prompt: |
      Move the redaction helper out of `@poe-code/braintrust` so the
      converters that will live in `@poe-code/acp-telemetry` can use it
      without depending on Braintrust.

      Steps:

      1. Read `packages/braintrust/src/redact.ts` and copy it verbatim to
         `packages/acp-telemetry/src/redact.ts`. Copy the colocated test
         (`packages/braintrust/src/redact.test.ts` if it exists) to
         `packages/acp-telemetry/src/redact.test.ts` and update imports.
      2. Re-export `redact` from `packages/acp-telemetry/src/index.ts`.
      3. Find every importer of `../redact.js` or `./redact.js` inside
         `packages/braintrust/src/**` (`grep -rn "redact" packages/braintrust/src`)
         and update those imports to `@poe-code/acp-telemetry`. Do not add a
         braintrust-side re-export — prefer direct import per CLAUDE.md
         ("functions that just proxy to another function are not allowed").
      4. Add `"@poe-code/acp-telemetry": "*"` to
         `packages/braintrust/package.json` dependencies.
      5. Delete `packages/braintrust/src/redact.ts` and its test.

      Acceptance: `npm run build` passes; `npm run test:unit` for both
      `packages/acp-telemetry` and `packages/braintrust` passes.
    status:
      implement: done
      commit: done

  - id: acp-to-trace-converter
    title: Port logSpawnSession into acpToTrace returning a pure AcpTrace value
    prompt: |
      Build the pure ACP → trace converter in `@poe-code/acp-telemetry`. No
      Braintrust SDK calls anywhere in this file.

      1. Create `packages/acp-telemetry/src/trace.ts` exporting:

         ```ts
         export interface AcpTraceSpan {
           name: string;
           kind: "agent" | "tool";
           input?: unknown;
           output?: unknown;
           metadata?: Record<string, unknown>;
           metrics?: Record<string, number>;
           startTs?: number;
           endTs?: number;
           children: AcpTraceSpan[];
         }

         export interface AcpTrace { root: AcpTraceSpan; }

         export function acpToTrace(ctx: AcpSpawnContext): AcpTrace;
         ```

         where `AcpSpawnContext` is imported from `@poe-code/agent-spawn`.

      2. Port the body of `logSpawnSession` and its helpers from
         `packages/braintrust/src/span-builder.ts` into pure functions inside
         `trace.ts`. Specifically port: `logToolSpans`, `accumulateAgentOutput`,
         `assembleToolOutput`, `buildMetrics`, `collectToolMeta`,
         `readContentText`, `asToolCall`, `asToolCallUpdate`, and the helper
         readers (`asRecord`, `readString`, `readNumber`, `addMetric`,
         `sumIfPresent`, `readToolInput`). Strip every Braintrust call —
         no `currentSpan()`, no `startSpan`, no `.log()`, no `.end()`. The
         function shape goes from "emit spans" to "build an `AcpTrace` tree".

      3. The root span:
         - `name: \`agent:\${ctx.agent}:\${ctx.model ?? "?"}\``
         - `kind: "agent"`
         - `input: redact({ prompt, mode, cwd })`
         - `output: redact(accumulateAgentOutput(events))`
         - `metadata: { sessionId, threadId, ...ctx.metadata }`
         - `metrics: buildMetrics(ctx)`
         - `children`: one `AcpTraceSpan` per tool_call event, in order.

      4. Each child tool span:
         - `name: \`tool_call:\${kind ?? "unknown"}\``
         - `kind: "tool"`
         - `input: redact(readToolInput(toolCall))`
         - `output: redact(assembleToolOutput(events, idx, toolCallId))`
         - `metadata`: merged `_meta` from the `tool_call` event and any
           matching `tool_call_update` events; rename `ts` to `startTs`
           on the call event and `endTs` on update events (same logic as
           the current `collectToolMeta`).
         - `startTs` / `endTs`: lifted from metadata when present so emitters
           can pass them to the SDK directly without re-parsing.

      5. Add `packages/acp-telemetry/src/trace.test.ts` covering:
         - empty event list → root span, no children, metrics from `ctx.usage`.
         - single tool_call + tool_call_update → one child with merged
           metadata and endTs.
         - multiple interleaved tool calls grouped correctly by `toolCallId`.
         - `agent_message_chunk` + `agent_message` events accumulated into
           root output.
         - usage normalization across `prompt_tokens` vs `inputTokens` etc.
         - `ctx.metadata.aborted = true` carried into root metadata.

      6. Re-export `acpToTrace`, `AcpTrace`, `AcpTraceSpan` from
         `packages/acp-telemetry/src/index.ts`.

      Out of scope: do not delete anything from `@poe-code/braintrust` yet —
      that happens in `braintrust-adapter-glue`. The two implementations
      coexist for one task so main stays green.

      Acceptance: `npm run build` passes; new tests pass; no new dependency
      added to `packages/acp-telemetry/package.json`.
    status:
      implement: done
      test: done
      commit: done

  - id: emit-to-braintrust
    title: Add emitToBraintrust sink in @poe-code/acp-telemetry
    prompt: |
      Add a Braintrust emitter that walks an `AcpTrace` and feeds it to a
      Braintrust span via a structural interface. The emitter must not
      import the `braintrust` package — the SDK object is passed in.

      1. Create `packages/acp-telemetry/src/emit-braintrust.ts` exporting:

         ```ts
         export interface BraintrustSpanLike {
           startSpan(args: { name: string; type: "task" | "tool" }): BraintrustSpanLike;
           log(event: {
             input?: unknown;
             output?: unknown;
             metadata?: Record<string, unknown>;
             metrics?: Record<string, number>;
           }): void;
           end(): void;
         }

         export function emitToBraintrust(trace: AcpTrace, parent: BraintrustSpanLike): void;
         ```

      2. Implementation: open a root span on `parent` with
         `{ name: trace.root.name, type: "task" }`, `.log()` the root's
         input/output/metadata/metrics, recurse for each child as
         `{ name: child.name, type: "tool" }`, `.log()` child fields, and
         `.end()` in a `finally` (matching the current
         `packages/braintrust/src/span-builder.ts` lifecycle). Skip
         `startTs`/`endTs` on `AcpTraceSpan` — Braintrust derives timing
         from the span lifecycle, not explicit timestamps.

      3. Add `packages/acp-telemetry/src/emit-braintrust.test.ts` using a
         fake `BraintrustSpanLike` (records every call). Drive it with
         fixtures imported from `trace.test.ts` (or build a small
         helper that produces canonical fixtures). Assert:
         - one root `startSpan` call with `type: "task"`.
         - one child `startSpan` per tool span with `type: "tool"`.
         - `.log()` args match span fields verbatim.
         - `.end()` called on every span, even when `.log()` throws.

      4. Re-export `emitToBraintrust` and `BraintrustSpanLike` from
         `packages/acp-telemetry/src/index.ts`.

      Out of scope: do not modify `@poe-code/braintrust` yet.

      Acceptance: `npm run build` passes; new tests pass; no `braintrust`
      dep added.
    status:
      implement: done
      test: done
      commit: done

  - id: braintrust-adapter-glue
    title: Shrink @poe-code/braintrust spawn adapter to acp-telemetry glue
    prompt: |
      Rewrite the Braintrust spawn adapter to use the
      `@poe-code/acp-telemetry` converter and emitter, then delete the
      dead code it replaces.

      1. Rewrite `packages/braintrust/src/adapters/spawn.ts` so
         `createSpawnMiddleware(client: BraintrustClient): AcpMiddleware`
         keeps its current signature, the same `aborted` metadata behavior
         on throw, and a `finally` block that does:

         ```ts
         try {
           const { currentSpan } = await import("braintrust");
           emitToBraintrust(acpToTrace(ctx), currentSpan() as BraintrustSpanLike);
         } catch (err) {
           client.recordError(err, "log spawn session");
         }
         ```

         Import `acpToTrace`, `emitToBraintrust`, and `BraintrustSpanLike`
         from `@poe-code/acp-telemetry`.

      2. Delete the ACP-specific code from
         `packages/braintrust/src/span-builder.ts`: `logSpawnSession`,
         `logToolSpans`, `accumulateAgentOutput`, `assembleToolOutput`,
         `buildMetrics`, `collectToolMeta`, `asToolCall`, `asToolCallUpdate`,
         `readContentText`, the local helpers, and the `BraintrustSpan` /
         `BraintrustSpanParent` interface definitions. Audit other files in
         `packages/braintrust/src/` (`grep -rn "span-builder"
         packages/braintrust/src`) and rewire any remaining importers to
         `@poe-code/acp-telemetry`. If nothing remains in `span-builder.ts`
         after the deletion, remove the file and drop its export from
         `packages/braintrust/src/index.ts`.

      3. Audit `packages/braintrust/src/index.ts` and remove exports of
         any symbols that no longer exist.

      4. Update `packages/braintrust/src/adapters/spawn.test.ts` to assert
         the new flow via a fake `BraintrustSpanLike` if it currently
         asserts on internals. The middleware contract (signature, error
         path, abort metadata) is unchanged — those assertions should
         survive untouched.

      Acceptance: `npm run build` passes; `npm run test:unit` for
      `packages/braintrust` passes; running `npm run dev -- spawn …`
      against a Braintrust-configured profile still produces a session
      log (manual smoke).
    status:
      implement: done
      test: done
      commit: done

  - id: emit-to-otel
    title: Add emitToOtel sink mapping AcpTrace to OTEL gen_ai semconv
    prompt: |
      Add an OTEL emitter alongside the Braintrust one. Same structural-
      interface pattern: no `@opentelemetry/*` import in the package.

      1. Create `packages/acp-telemetry/src/emit-otel.ts` exporting:

         ```ts
         export interface OtelSpanLike {
           setAttribute(key: string, value: string | number | boolean): void;
           setAttributes(attrs: Record<string, string | number | boolean>): void;
           end(endTime?: number): void;
         }

         export interface OtelTracerLike {
           startSpan(name: string, options?: { startTime?: number }): OtelSpanLike;
         }

         export function emitToOtel(trace: AcpTrace, tracer: OtelTracerLike): void;
         ```

      2. Implementation: one OTEL span per `AcpTraceSpan`. Pass `startTime`
         when `span.startTs` is set. Map attributes following the
         OpenTelemetry GenAI semantic conventions where they apply:

         - root span:
           - `gen_ai.system: "poe-code"` (constant)
           - `gen_ai.request.model: <model from name suffix>` (when present)
           - `gen_ai.agent.name: <agent from name>` (when present)
           - `gen_ai.usage.input_tokens: metrics.prompt_tokens` (when present)
           - `gen_ai.usage.output_tokens: metrics.completion_tokens` (when present)
           - `gen_ai.usage.cached_tokens: metrics.prompt_cached_tokens` (when present)
           - `poe_code.session_id: metadata.sessionId`
           - `poe_code.thread_id: metadata.threadId` (when present)
         - tool span:
           - `gen_ai.tool.name: <kind from name suffix>` (when present)
           - `poe_code.tool_call_id: metadata.toolCallId` (when present)

         For non-primitive `input` / `output`: JSON-stringify and set as a
         single attribute `poe_code.input` / `poe_code.output`. Skip when
         the field is `undefined`.

         Call `end(span.endTs)` when defined, else `end()`.

      3. Add `packages/acp-telemetry/src/emit-otel.test.ts` using a fake
         `OtelTracerLike`. Drive it with the same fixtures the Braintrust
         emitter test uses. Assert the attribute mapping table verbatim,
         confirm `startTime`/`endTime` are passed through when present, and
         confirm complex inputs are JSON-stringified into a single
         attribute.

      4. Re-export `emitToOtel`, `OtelSpanLike`, `OtelTracerLike` from
         `packages/acp-telemetry/src/index.ts`.

      Out of scope: no OTEL collector wiring, no SDK setup, no end-to-end
      OTEL traces. The emitter takes a tracer object; how it's created is
      the caller's problem.

      Acceptance: `npm run build` passes; new tests pass; no
      `@opentelemetry/*` dep added to `packages/acp-telemetry/package.json`.
    status:
      implement: open
      test: open
      commit: open
---

# ACP telemetry converters (Braintrust + OTEL)

Replace direct Braintrust calls in the spawn integration with pure ACP→span converters; expose Braintrust and OTEL emitters as thin sinks over a shared `AcpTrace` shape.

## 1. What we're building

Refactor of the Braintrust integration. End state:

- `@poe-code/agent-spawn` exposes middleware as the first-class extension point (existing `AcpMiddleware` type) and remains free of any Braintrust / OTEL import. Middleware can be registered from outside via the SDK by passing `middlewares: AcpMiddleware[]` on the spawn options.
- A new package `@poe-code/acp-telemetry` provides pure functions:
  - `acpToTrace(ctx)` — turns an `AcpSpawnContext` (sessionId, prompt, events, usage, metadata) into a normalized `AcpTrace` value (root span + nested tool spans + metrics + redacted I/O).
  - `emitToBraintrust(trace, parentSpan)` — walks `AcpTrace` and calls `parentSpan.startSpan` / `span.log` / `span.end`. Knows the Braintrust span shape only.
  - `emitToOtel(trace, tracer)` — walks `AcpTrace` and calls `tracer.startSpan` / `span.setAttribute` / `span.end`. Knows the OTEL span shape only.
- `@poe-code/braintrust` shrinks to a glue layer: its spawn middleware factory becomes a thin function that calls `acpToTrace`, then `emitToBraintrust` under `currentSpan()`.
- Non-goals:
  - No new OTEL exporter wiring (no collector, no SDK setup). We expose `emitToOtel(trace, tracer)` and stop. Anyone setting up an OTEL tracer can plug it in.
  - No changes to ACP types, spawn streaming, or pipeline/experiment Braintrust adapters in this pass — those adapters continue to use `BraintrustClient` directly for non-ACP data (experiment rows, pipeline tasks). Only the ACP→span conversion is extracted.
  - No retention/redaction policy changes — the current `redact()` behavior moves with the converter.

## 2. User-facing shape

The user here is anyone wiring telemetry into spawn. Three usage shapes:

### a. Default (Braintrust on, as today)

No call-site change. The CLI keeps doing:

```ts
import { loadIntegrations } from "@poe-code/braintrust";

const { spawnMiddleware } = await loadIntegrations(config);
await spawnStreaming({ prompt, agentId, middlewares: [spawnMiddleware] });
```

Internally `loadIntegrations` returns the Braintrust spawn middleware, which now uses `@poe-code/acp-telemetry` under the hood. No behavior change visible to existing users.

### b. Custom middleware via the SDK

The point of the refactor: anyone calling `@poe-code/agent-spawn` directly can register their own middleware on the spawn options. No CLI involvement.

```ts
import { spawnStreaming, type AcpMiddleware } from "@poe-code/agent-spawn";
import { acpToTrace } from "@poe-code/acp-telemetry";

const myMiddleware: AcpMiddleware = async (ctx, next) => {
  try {
    await next();
  } finally {
    const trace = acpToTrace(ctx);
    await mySink.write(trace);
  }
};

const { events, done } = spawnStreaming({
  prompt: "ship it",
  agentId: "claude",
  middlewares: [myMiddleware],
});
```

`AcpTrace` is plain data — no Braintrust, no OTEL dependency. A consumer can drop in any middleware; `applyMiddlewares` runs them in onion order inside the spawn engine.

### c. OTEL middleware

```ts
import { trace } from "@opentelemetry/api";
import { spawnStreaming, type AcpMiddleware } from "@poe-code/agent-spawn";
import { acpToTrace, emitToOtel } from "@poe-code/acp-telemetry";

const tracer = trace.getTracer("poe-code");

const otelMiddleware: AcpMiddleware = async (ctx, next) => {
  try {
    await next();
  } finally {
    emitToOtel(acpToTrace(ctx), tracer);
  }
};

spawnStreaming({ prompt, agentId, middlewares: [otelMiddleware] });
```

`emitToOtel` opens one root span per session and a child span per tool call, mirroring the Braintrust layout. Attribute keys follow `gen_ai.*` semantic conventions where they apply (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, etc.).

## 3. Implementation details and technical decisions

### Layering

```
agent-spawn          (no telemetry deps; exposes AcpMiddleware + SpawnContext)
   ↑
acp-telemetry        (pure: AcpTrace shape + acpToTrace + emitToBraintrust + emitToOtel)
   ↑                                 ↑
braintrust           opentelemetry consumer (user-owned)
(spawn adapter is glue)
```

`acp-telemetry` depends on `@poe-code/agent-spawn` for the `AcpSpawnContext` / `AcpEvent` types only. It does NOT depend on `braintrust` or `@opentelemetry/api`. Both emitter functions take their SDK objects as parameters (structural-typed), so the package ships with zero SDK deps.

### `AcpTrace` data shape

A normalized, SDK-agnostic representation produced by `acpToTrace(ctx)`:

```ts
export interface AcpTrace {
  root: AcpTraceSpan;
}

export interface AcpTraceSpan {
  name: string;             // e.g. "agent:claude:claude-sonnet-4-6"
  kind: "agent" | "tool";
  input?: unknown;          // already redacted
  output?: unknown;         // already redacted
  metadata?: Record<string, unknown>;
  metrics?: Record<string, number>;
  startTs?: number;         // ms epoch, when known from event _meta
  endTs?: number;
  children: AcpTraceSpan[];
}
```

The agent root carries the session/thread/model metadata and aggregated usage metrics. Each tool span captures kind, input/output, and `_meta` timestamps. Order matches event order. This shape is the contract between converter and emitters.

### Where the code currently is → where it goes

| Current ([file](file)) | New location |
|---|---|
| [packages/braintrust/src/span-builder.ts](packages/braintrust/src/span-builder.ts) `logSpawnSession`, `logToolSpans`, `accumulateAgentOutput`, `assembleToolOutput`, `buildMetrics`, `collectToolMeta` | `packages/acp-telemetry/src/trace.ts` (renamed `acpToTrace`, returns `AcpTrace`; no SDK calls) |
| [packages/braintrust/src/redact.ts](packages/braintrust/src/redact.ts) | `packages/acp-telemetry/src/redact.ts` (moved verbatim) |
| `currentSpan().startSpan/log/end` calls in span-builder | `packages/acp-telemetry/src/emit-braintrust.ts` (`emitToBraintrust`) |
| (new) | `packages/acp-telemetry/src/emit-otel.ts` (`emitToOtel`) |
| [packages/braintrust/src/adapters/spawn.ts](packages/braintrust/src/adapters/spawn.ts) | Stays. Becomes 10-line glue: `acpToTrace` → `import("braintrust").currentSpan()` → `emitToBraintrust`. |

### SDK middleware registration

Today `AcpMiddleware` and `applyMiddlewares` are exported from `@poe-code/agent-spawn`, but `SpawnOptions` has no `middlewares` field. The CLI passes a `middlewares` array through its own `SpawnCommandOptions` shape ([src/cli/commands/spawn.ts:208-210](src/cli/commands/spawn.ts#L208-L210)) and the CLI handler arranges to call `applyMiddlewares` around the spawn. That works for the CLI but means an SDK consumer cannot register middleware declaratively — they would have to call `applyMiddlewares` themselves.

This refactor makes middleware a first-class SDK option:

- Add `middlewares?: AcpMiddleware[]` to `SpawnOptions` in [packages/agent-spawn/src/types.ts](packages/agent-spawn/src/types.ts).
- The ACP-streaming entry points (`spawnStreaming`, `spawnAcp`) wrap their core flow with `applyMiddlewares(middlewares, ctx)`, populating `ctx.events`, `ctx.usage`, etc. before invoking `next()` (or after, depending on existing middleware semantics — match the order currently used by the CLI handler so existing middlewares like `sessionCapture`, `usageCapture`, `spawnLog` keep working).
- The CLI's `SpawnCommandOptions.middlewares` field is forwarded directly into `SpawnOptions.middlewares`; the bespoke CLI-side `applyMiddlewares` call is removed in favor of the SDK doing it. Single mechanism, one code path.
- `applyMiddlewares` stays exported for advanced users who want to compose middleware outside a spawn call (e.g. replay/testing).

This is the substantive change in `@poe-code/agent-spawn` — everything else in this plan is movement of code into `@poe-code/acp-telemetry`.

### Decoupling spawn from telemetry SDKs

After the refactor:

- `agent-spawn` package.json has no `braintrust`, no `@opentelemetry/*`.
- `acp-telemetry` package.json has neither in `dependencies` (or `peerDependencies`). Both SDKs are passed in as parameters.
- The Braintrust spawn middleware lives in `@poe-code/braintrust` and is the only place that imports `braintrust` for ACP traces.

### Pipeline / experiment / superintendent adapters

These continue to live in `@poe-code/braintrust` and continue to call Braintrust directly because they log non-ACP rows (experiment runs, pipeline tasks, superintendent role outputs). They are out of scope for this plan. Only the spawn adapter changes.

### Edge cases handled by the converter

- Events arriving without `_meta.ts` → `startTs`/`endTs` omitted from `AcpTraceSpan`.
- Tool updates with no `toolCallId` → matched positionally to the most recent open tool call (current behavior).
- Tool output split across `rawOutput` + text chunks → preserved as-is (array vs scalar based on count).
- Usage shapes from different agents (`prompt_tokens` vs `inputTokens`) → normalized inside `buildMetrics`, output keys remain stable.
- `ctx.metadata.aborted` (set by the existing error path) → carried through into the root span metadata.

### Flags / config

None. Behavior is unchanged when Braintrust is configured. The new package is a refactor target, not a feature flag.

## 4. Interfaces and test plan

### `@poe-code/agent-spawn` surface additions

```ts
// types.ts — addition only, no breaking changes
export interface SpawnOptions {
  // ...existing fields...
  middlewares?: AcpMiddleware[];
}
```

`spawnStreaming` / `spawnAcp` internally wrap their per-session run with `applyMiddlewares(opts.middlewares ?? [], ctx)`. Existing direct callers of `applyMiddlewares` continue to work because the export stays.

### Public API of `@poe-code/acp-telemetry`

```ts
// trace.ts
export interface AcpTraceSpan {
  name: string;
  kind: "agent" | "tool";
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  metrics?: Record<string, number>;
  startTs?: number;
  endTs?: number;
  children: AcpTraceSpan[];
}

export interface AcpTrace { root: AcpTraceSpan; }

export function acpToTrace(ctx: AcpSpawnContext): AcpTrace;

// emit-braintrust.ts
export interface BraintrustSpanLike {
  startSpan(args: { name: string; type: "task" | "tool" }): BraintrustSpanLike;
  log(event: {
    input?: unknown;
    output?: unknown;
    metadata?: Record<string, unknown>;
    metrics?: Record<string, number>;
  }): void;
  end(): void;
}

export function emitToBraintrust(trace: AcpTrace, parent: BraintrustSpanLike): void;

// emit-otel.ts
export interface OtelTracerLike {
  startSpan(name: string, options?: { startTime?: number }): OtelSpanLike;
}
export interface OtelSpanLike {
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(attrs: Record<string, string | number | boolean>): void;
  end(endTime?: number): void;
}

export function emitToOtel(trace: AcpTrace, tracer: OtelTracerLike): void;
```

### `@poe-code/braintrust` after refactor

`createSpawnMiddleware(client)` keeps its signature. Its body becomes:

```ts
return async (ctx, next) => {
  try { await next(); }
  catch (err) {
    (ctx as { metadata?: Record<string, unknown> }).metadata = {
      ...(ctx as { metadata?: Record<string, unknown> }).metadata,
      aborted: true,
    };
    throw err;
  }
  finally {
    try {
      const { currentSpan } = await import("braintrust");
      emitToBraintrust(acpToTrace(ctx), currentSpan() as BraintrustSpanLike);
    } catch (err) {
      client.recordError(err, "log spawn session");
    }
  }
};
```

### Tests

`packages/acp-telemetry/src/trace.test.ts` — unit tests against `acpToTrace`:
- empty event list → root span with metrics from `ctx.usage`, no children.
- single tool_call + tool_call_update → one child span with merged metadata, `endTs` from update.
- multiple interleaved tool calls → correct grouping by `toolCallId`.
- agent_message_chunk + agent_message events → accumulated output text.
- usage normalization across snake_case and camelCase variants.
- `ctx.metadata.aborted = true` → carried into root metadata.

`packages/acp-telemetry/src/emit-braintrust.test.ts` — fake `BraintrustSpanLike` records calls. Assert the `startSpan`/`log`/`end` sequence and arg shape against fixture traces. (Replaces today's coverage in [packages/braintrust/src/span-builder.test.ts](packages/braintrust/src/span-builder.test.ts) if present; otherwise net-new.)

`packages/acp-telemetry/src/emit-otel.test.ts` — fake `OtelTracerLike`. Assert:
- one root span per trace, attribute keys follow `gen_ai.*` mapping table.
- one child span per tool call.
- `setAttribute` called for primitives only; complex `input`/`output` is JSON-stringified into a single attribute.
- `startTime`/`endTime` passed when present in the trace.

`packages/braintrust/src/adapters/spawn.test.ts` — keep existing tests; they should pass unchanged because the middleware contract is identical. If they currently assert on internals, update them to assert on the emitted Braintrust span calls via a fake.

No new e2e. No new manual QA. Run `npm run test:unit` for the affected packages and `npm run lint`.

### Rollout / migration

In-repo only. No external consumers of `@poe-code/braintrust` spawn internals. `loadIntegrations` and the CLI wiring are unchanged. One commit per logical step, straight to main.

### Autonomy checklist

An agent executing this plan needs:

- File list and signatures (section 5) — provided.
- Existing test fixtures in `packages/braintrust/src/` for sample ACP event streams — reuse them as the canonical fixtures in `acp-telemetry` tests. If none exist, build a minimal fixture from event types in [packages/poe-acp-client/src/types.ts](packages/poe-acp-client/src/types.ts).
- Confirmation that `@poe-code/agent-spawn` exports `AcpSpawnContext` and `AcpEvent` — yes, see [packages/agent-spawn/src/index.ts](packages/agent-spawn/src/index.ts) lines 67–97.
- Confirmation that the Braintrust spawn adapter has only one call site (`loadIntegrations`) — yes.

## 5. Code plan

### Files to create

- `packages/acp-telemetry/package.json` — name `@poe-code/acp-telemetry`, `private: true`, dep on `@poe-code/agent-spawn`.
- `packages/acp-telemetry/README.md` — required by repo rules; lists exports, no env vars, no config.
- `packages/acp-telemetry/tsconfig.json` — mirror `packages/braintrust/tsconfig.json`.
- `packages/acp-telemetry/src/index.ts` — re-exports.
- `packages/acp-telemetry/src/trace.ts` — `AcpTrace`, `AcpTraceSpan`, `acpToTrace`.
- `packages/acp-telemetry/src/redact.ts` — moved from braintrust.
- `packages/acp-telemetry/src/emit-braintrust.ts` — `BraintrustSpanLike`, `emitToBraintrust`.
- `packages/acp-telemetry/src/emit-otel.ts` — `OtelTracerLike`, `OtelSpanLike`, `emitToOtel`.
- `packages/acp-telemetry/src/trace.test.ts`
- `packages/acp-telemetry/src/emit-braintrust.test.ts`
- `packages/acp-telemetry/src/emit-otel.test.ts`

### Files to change

- [packages/agent-spawn/src/types.ts](packages/agent-spawn/src/types.ts) — add `middlewares?: AcpMiddleware[]` to `SpawnOptions`. Import the type from `./acp/middleware.js`.
- [packages/agent-spawn/src/acp/spawn.ts](packages/agent-spawn/src/acp/spawn.ts) — wrap the per-session run inside `spawnStreaming` with `applyMiddlewares(opts.middlewares ?? [], ctx)`. Match the existing order used by the CLI handler.
- [packages/agent-spawn/src/acp/spawn-acp.ts](packages/agent-spawn/src/acp/spawn-acp.ts) — same wrap for `spawnAcp`.
- [src/cli/commands/spawn.ts](src/cli/commands/spawn.ts) — keep passing `middlewares` through `SpawnCommandOptions`; remove the bespoke `applyMiddlewares` call in the handler now that the SDK handles it. The CLI just forwards `middlewares` into spawn options.
- [src/cli/commands/pipeline.ts](src/cli/commands/pipeline.ts) — same simplification at line 594, 932.
- [src/cli/commands/experiment.ts](src/cli/commands/experiment.ts) — same simplification at lines 383, 756.
- [packages/braintrust/package.json](packages/braintrust/package.json) — add `"@poe-code/acp-telemetry": "*"`.
- [packages/braintrust/src/adapters/spawn.ts](packages/braintrust/src/adapters/spawn.ts) — replace `logSpawnSession` call with `emitToBraintrust(acpToTrace(ctx), currentSpan())`.
- [packages/braintrust/src/span-builder.ts](packages/braintrust/src/span-builder.ts) — delete the ACP-specific code (`logSpawnSession`, `logToolSpans`, `accumulateAgentOutput`, `assembleToolOutput`, `buildMetrics`, `collectToolMeta`, `asToolCall`, `asToolCallUpdate`, helpers). Keep anything still used by other adapters (none, after audit — likely the whole file is deletable; check imports first).
- [packages/braintrust/src/redact.ts](packages/braintrust/src/redact.ts) — delete after moving to acp-telemetry. Replace remaining importers with `@poe-code/acp-telemetry` import.
- [packages/braintrust/src/index.ts](packages/braintrust/src/index.ts) — drop exports of removed symbols.
- Root `tsconfig.json` / workspace config — register the new package if the repo lists packages explicitly.
- [packages/braintrust/src/adapters/spawn.test.ts](packages/braintrust/src/adapters/spawn.test.ts) — adjust to fake span sink if it asserts on internals.

### New / modified function signatures

```ts
// packages/acp-telemetry/src/trace.ts
export function acpToTrace(ctx: AcpSpawnContext): AcpTrace;

// packages/acp-telemetry/src/emit-braintrust.ts
export function emitToBraintrust(trace: AcpTrace, parent: BraintrustSpanLike): void;

// packages/acp-telemetry/src/emit-otel.ts
export function emitToOtel(trace: AcpTrace, tracer: OtelTracerLike): void;

// packages/braintrust/src/adapters/spawn.ts (unchanged signature)
export function createSpawnMiddleware(client: BraintrustClient): AcpMiddleware;
```

### Build order (keeps main green)

1. Add `middlewares?: AcpMiddleware[]` to `SpawnOptions`. Wire `applyMiddlewares` inside `spawnStreaming` and `spawnAcp`. Existing CLI call sites still work because they keep passing `middlewares` through; remove duplicate CLI-side `applyMiddlewares` calls in the same commit. Run agent-spawn + CLI tests.
2. Create `@poe-code/acp-telemetry` package skeleton (package.json, tsconfig, README, empty `index.ts`). Verify it builds.
3. Move `redact.ts` from braintrust to acp-telemetry. Update braintrust imports to point at the new package. Run unit tests.
4. Port `logSpawnSession` and helpers into `acp-telemetry/src/trace.ts` as `acpToTrace`, returning `AcpTrace`. Add `trace.test.ts` with fixtures derived from existing event shapes. Run unit tests.
5. Add `emit-braintrust.ts` with `emitToBraintrust(trace, parent)`. Add `emit-braintrust.test.ts` using a fake span. Run unit tests.
6. Rewrite `packages/braintrust/src/adapters/spawn.ts` to use `acpToTrace` + `emitToBraintrust`. Delete the now-unused code in `span-builder.ts`. Run braintrust unit tests + spawn adapter tests.
7. Add `emit-otel.ts` and `emit-otel.test.ts`. Define the `gen_ai.*` attribute mapping in tests.
8. Final pass: `npm run lint`, `npm run test:unit` across affected packages. Conventional-commit each step; relevant plan path goes in the commit body.
