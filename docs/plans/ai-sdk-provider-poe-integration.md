# Integration: ai-sdk-provider-poe

## Summary

Replace the hand-rolled HTTP calls across poe-code with [`ai-sdk-provider-poe`](https://github.com/poe-platform/ai-sdk-provider-poe), gaining first-party AI SDK routing (Anthropic Messages API, OpenAI Responses API, Google, etc.) and runtime model discovery with rich metadata.

Three integration surfaces:

| Surface | Current | After |
|---------|---------|-------|
| **poe-agent** (`packages/poe-agent`) | `PoeChatService` — raw fetch to `/v1/chat/completions` | Vercel AI SDK `generateText()` via `poe()` provider — first-party routing, streaming, tool calling |
| **generate** (`src/sdk/generate.ts`, `src/services/llm-client.ts`) | Raw fetch to `/v1/chat/completions` | `generateText()` / `streamText()` via `poe()` — typed responses, proper error handling |
| **models CLI** (`src/cli/commands/models.ts`) | Raw fetch to `/v1/models` | `fetchPoeModels()` — typed model metadata with capabilities, pricing, reasoning support |

## Dependencies

```
bun add ai-sdk-provider-poe ai
```

- `ai` — Vercel AI SDK core (peer dep of `ai-sdk-provider-poe`)
- `ai-sdk-provider-poe` — Poe provider for Vercel AI SDK

## Phase 1: models CLI → `fetchPoeModels()`

**Why first**: Lowest risk, self-contained command, validates the SDK works with existing auth.

### Changes

1. **`src/cli/commands/models.ts`** — Replace raw HTTP fetch with `fetchPoeModels()`

   Current:
   ```ts
   const response = await container.httpClient(`${container.env.poeBaseUrl}/v1/models`, { ... });
   const result = await response.json();
   ```

   After:
   ```ts
   import { fetchPoeModels } from "ai-sdk-provider-poe";

   const models = await fetchPoeModels({ apiKey });
   ```

   The `fetchPoeModels()` returns typed model objects with: `id`, `rawId`, `ownedBy`, `contextWindow`, `maxOutputTokens`, `supportsImages`, `supportsPromptCache`, `supportsReasoningBudget`, `supportsReasoningEffort`, `pricing`.

2. **Map SDK model shape → existing `ModelEntry` interface** (or replace it). The SDK gives us richer metadata than the raw API — we get `supportsReasoningBudget`, `supportsReasoningEffort`, `supportsPromptCache` as booleans instead of opaque feature arrays.

3. **Keep existing filter/view logic** — filters and table rendering stay the same, just the data source changes.

### Tests

- Unit test: mock `fetchPoeModels` → verify filtering, views, formatting still work
- Screenshot: `bun run screenshot-poe-code -- models --provider anthropic`

## Phase 2: generate → Vercel AI SDK `generateText()`

**Why second**: Replaces `LlmClient` with typed AI SDK calls, benefiting both CLI and SDK.

### Changes

1. **`src/services/llm-client.ts`** — Rewrite `createPoeClient()` to use `poe()` provider internally

   Current:
   ```ts
   // Raw fetch to /v1/chat/completions
   const response = await httpClient(`${baseUrl}/chat/completions`, { ... });
   ```

   After:
   ```ts
   import { createPoe } from "ai-sdk-provider-poe";
   import { generateText } from "ai";

   const provider = createPoe({ apiKey });
   const { text } = await generateText({
     model: provider(modelId),
     prompt,
   });
   ```

   The `LlmClient` interface stays the same (text/media methods) — only the implementation changes. This preserves all downstream consumers.

2. **Media generation**: The Vercel AI SDK doesn't have a native media generation path. Two options:
   - **Option A**: Keep raw HTTP for media, only migrate text → cleanest separation
   - **Option B**: Use `generateText()` and parse the response for URLs (current behavior already parses JSON/markdown from text responses)

   Recommend **Option A** — media generation is a Poe-specific feature that doesn't map to the standard AI SDK abstraction.

3. **`src/sdk/generate.ts`** — No interface changes. It calls `LlmClient.text()` which is the seam we're replacing.

4. **Extended thinking support** — The Poe SDK supports `reasoningBudget` for Anthropic models. Surface this as a new `--reasoning-budget` param on the generate CLI.

### Tests

- Unit test: mock at AI SDK level → verify generate still returns content
- Existing generate tests should pass with mocked provider

## Phase 3: poe-agent → Vercel AI SDK with tool calling

**Why last**: Most complex, touches the agent runtime, needs careful streaming/tool-call handling.

### Changes

1. **`packages/poe-agent/src/chat.ts`** — Replace `PoeChatService` with AI SDK

   Current flow:
   ```
   POST /v1/chat/completions → parse tool_calls → execute tools → POST again → loop
   ```

   After:
   ```ts
   import { createPoe } from "ai-sdk-provider-poe";
   import { generateText } from "ai";

   const provider = createPoe({ apiKey, baseUrl });
   const result = await generateText({
     model: provider(modelId),
     messages,
     tools: convertedTools,
     maxSteps: maxToolCallIterations,  // AI SDK handles the tool loop
   });
   ```

   Key benefits:
   - AI SDK handles the tool-call loop natively (`maxSteps`)
   - First-party routing means Anthropic models use the Messages API (better tool calling)
   - OpenAI models use the Responses API
   - Streaming via `streamText()` for real-time session updates

2. **Tool definition conversion** — Current tools use OpenAI function-calling format. AI SDK uses its own `tool()` helper:

   ```ts
   import { tool } from "ai";
   import { z } from "zod";

   const readFileTool = tool({
     description: "Read file content",
     parameters: z.object({ path: z.string() }),
     execute: async ({ path }) => executor.readFile(path),
   });
   ```

   This means converting `DefaultToolExecutor` and `McpToolExecutor` tool definitions to AI SDK format.

3. **Session update streaming** — Replace manual chunk parsing with AI SDK's `streamText()`:

   ```ts
   const result = streamText({
     model: provider(modelId),
     messages,
     tools,
     maxSteps,
     onStepFinish: (step) => {
       // Emit ACP-compatible session updates
     },
   });

   for await (const chunk of result.textStream) {
     onSessionUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunk } });
   }
   ```

4. **`packages/poe-agent/package.json`** — Add deps:
   ```json
   "ai-sdk-provider-poe": "^x.x.x",
   "ai": "^x.x.x",
   "zod": "^3.x.x"
   ```

### Tests

- Unit test: mock AI SDK `generateText` → verify tool loop, session updates, error handling
- E2E: `bun run e2e:verbose` (poe-agent spawn flow)
- Spot test: `bun run dev -- spawn poe-agent "list files"`

## Migration Strategy

Each phase is independently shippable. The `LlmClient` interface acts as the seam — we can swap the implementation without changing consumers.

```
Phase 1 (models)    → commit + merge
Phase 2 (generate)  → commit + merge
Phase 3 (poe-agent) → commit + merge
```

No breaking changes to the SDK public API (`spawn`, `generate`, `generateImage`, etc.).

## Risks & Considerations

1. **Bundle size** — `ai` package is substantial. Need to verify it doesn't bloat the CLI bundle excessively. The `ai-sdk-provider-poe` itself is lightweight.

2. **Media generation** — AI SDK doesn't have a standard media generation path. We keep raw HTTP for image/video/audio.

3. **Error mapping** — AI SDK errors may differ from current `ApiError` format. Need adapter layer in `llm-client.ts`.

4. **Streaming compatibility** — The poe-agent emits `SessionUpdate` events. Need to verify AI SDK's streaming callbacks map cleanly to the existing event model.

5. **zod dependency** — AI SDK tool definitions require zod schemas. The `poe-agent` package currently has no zod dependency. This adds a new dep to the agent package.
