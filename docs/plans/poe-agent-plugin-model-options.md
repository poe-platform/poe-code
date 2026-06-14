---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Poe Agent Plugin Model Options

Move OpenAI Responses model selection and model-specific request options into the provider plugin configuration.

## 1. What we're building

Change `@poe-code/poe-agent` so this pattern:

```ts
const run = await agent()
  .model("gpt-5.5")
  .use(openaiResponsesPlugin())
  .use(systemPromptPlugin())
  .run("Summarize the current repository", {
    cwd: process.cwd()
  });
```

can instead be written as:

```ts
const run = await agent()
  .use(openaiResponsesPlugin({ model: "gpt-5.5", reasoning: { effort: "high" } }))
  .use(systemPromptPlugin())
  .run("Summarize the current repository", {
    cwd: process.cwd()
  });
```

The OpenAI Responses plugin should own its model selection and model-specific request options when they are supplied through the plugin. The generic `.model(...)` builder method should remain available for provider plugins that do not configure their own model, existing callers, and injected test models.

Provider request params should pass through to the underlying provider SDK/API using the provider's own supported shape. `poe-agent` should not maintain an allowlist of request params, reject unknown provider params, or rename provider params into repo-specific aliases. For OpenAI Responses, request params such as `reasoning`, `include`, and future Responses API fields should be forwarded without filtering or validation, while client/runtime-only options such as `apiKey`, `baseUrl`, `fetch`, `timeout`, and `maxRetries` remain runtime configuration.

Explicit non-goals:

- Do not remove `.model(...)`.
- Do not make `agent()` provider-specific.
- Do not add provider-name branching to the builder or runtime.
- Do not duplicate model information in both `.model(...)` and plugin options when one can infer the active provider model from plugin configuration.
- Do not filter or validate provider request params beyond separating them from client/runtime options needed by the plugin itself.

## 2. User-facing shape

This is an SDK/API change in `@poe-code/poe-agent`.

### OpenAI Responses as the primary example

Callers can configure the provider, model, and Responses request params in one plugin call:

```ts
import {
  agent,
  openaiResponsesPlugin,
  systemPromptPlugin
} from "@poe-code/poe-agent";

const result = await agent()
  .use(
    openaiResponsesPlugin({
      model: "gpt-5.5",
      reasoning: { effort: "high" },
      include: ["reasoning.encrypted_content"],
      text: { verbosity: "medium" }
    })
  )
  .use(systemPromptPlugin())
  .run("Summarize the current repository", {
    cwd: process.cwd()
  });
```

`model`, `reasoning`, `include`, `text`, and any future OpenAI Responses request params are passed to `openai.responses.stream(...)` in the provider-native request shape. `poe-agent` does not allowlist these keys, rename them, or validate their values.

Client/runtime options remain plugin options because the provider implementation needs them before making a request:

```ts
openaiResponsesPlugin({
  model: "gpt-5.5",
  reasoning: { effort: "high" },
  apiKey: process.env.POE_API_KEY,
  baseUrl: "https://api.poe.com/v1",
  timeout: 120_000,
  maxRetries: 2,
  defaultHeaders: {
    "x-trace-id": "repo-summary-1"
  }
});
```

### Existing `.model(...)` usage stays valid

Existing callers do not need to migrate immediately:

```ts
const result = await agent()
  .model("gpt-5.5")
  .use(openaiResponsesPlugin())
  .use(systemPromptPlugin())
  .run("Summarize the current repository", {
    cwd: process.cwd()
  });
```

`.model(...)` is the fallback model source when no provider plugin supplies its own model. This keeps injected `acpModel` tests, custom providers, and current callers working.

### No duplicated model configuration

Callers choose one model source for a run:

```ts
// Preferred when the provider plugin owns the model and request params.
agent().use(openaiResponsesPlugin({ model: "gpt-5.5", reasoning: { effort: "high" } }));

// Still valid when the provider plugin is model-agnostic.
agent().model("custom/provider-model").use(customProviderPlugin());
```

Supplying both `.model(...)` and a provider plugin `model` for the same run is a `poe-agent` configuration error before any provider request is made:

```ts
await agent()
  .model("gpt-5.5")
  .use(openaiResponsesPlugin({ model: "gpt-5.5" }))
  .run("hello");
// throws: model was configured both on the agent builder and by a provider plugin
```

This error is about ambiguous `poe-agent` composition, not validation of provider request params.

### Provider params are not a registry contract

Built-in plugin config and config-file loading should not require every provider request param to be represented in `parse-options.ts` helpers or in `PluginSpec.parseOptions(...)` allowlists. The public contract is:

```ts
type OpenaiResponsesPluginOptions = OpenaiResponsesClientOptions &
  OpenaiResponsesRequestOptions;
```

where `OpenaiResponsesRequestOptions` is provider-pass-through data. The exact request option fields should come from the installed provider SDK types where practical, not from a manually maintained repo enum.

### Error shape

Provider-side invalid params fail as provider/API errors:

```ts
await agent()
  .use(openaiResponsesPlugin({ model: "gpt-5.5", made_up_provider_param: true }))
  .run("hello");
```

`poe-agent` forwards the request. If the provider rejects the param, the caller sees the provider error through the existing run failure path.

## 3. Implementation details and technical decisions

### Autonomy audit

- Env vars: no new env vars. Existing `POE_API_KEY`, `POE_BASE_URL`, and auth-store fallback behavior remain unchanged.
- Credentials: unit tests use mocked OpenAI SDK and mocked auth-store, so no real credentials are required.
- Network: unit tests do not use the network. The real-world QA command can use a fake `fetch` or mocked provider path for deterministic validation.
- Running services: none required.
- Sample data: none required.
- README permission: [packages/poe-agent/README.md](/Users/kjopek/Workspace/poe-code/packages/poe-agent/README.md) documents plugin config today. Updating it is required by package rules once implementation starts, but repo instructions require explicit user permission before README edits. Treat README edits as a separate user-approved step if this plan is executed.

### Runtime model source

Add a provider-owned model source to the generic provider contract:

```ts
export type Provider = {
  name: string;
  model?: string;
  supports(modelId: string): boolean;
  createModel(modelId: string, ctx: ProviderContext): AcpModel | Promise<AcpModel>;
};
```

`Provider.model` is optional metadata. It means "this provider plugin was configured with the concrete model for this run." It does not replace `supports(...)`; the runtime still calls `supports(modelId)` before selecting the provider.

Model resolution becomes:

1. If `options.acpModel` exists and no builder/plugin model exists, use `"injected-acp-model"` as today.
2. Collect providers after plugin setup.
3. Read all non-empty `provider.model` values.
4. If more than one provider supplies a model, throw a configuration error before any provider request.
5. If both builder `.model(...)` and one provider supplies `model`, throw a configuration error before any provider request.
6. Otherwise use provider `model`, builder `.model(...)`, or injected model placeholder in that order.
7. Resolve the provider with `resolveProvider(providers, modelName)` as today.

This keeps `agent.ts` provider-agnostic. It only understands "a provider can supply a model"; it does not know about OpenAI Responses.

### Provider request param pass-through

For OpenAI Responses, split options conceptually into:

```ts
type OpenaiResponsesClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
};

type OpenaiResponsesPluginOptions = OpenaiResponsesClientOptions &
  OpenaiResponsesRequestOptions;
```

`OpenaiResponsesRequestOptions` should be derived from the installed OpenAI SDK request type where practical. The important behavior is structural: keys that are not client/runtime keys remain request params and are forwarded into `openai.responses.stream(...)`.

Implementation rule:

- Do not call `rejectUnknownKeys(...)` for provider request options.
- Do not add `readOptionalEnum(...)` allowlists for provider request options.
- Do not rename provider-native `reasoning: { effort, summary }` into repo-specific fields.
- Do not convert repo-specific option aliases into provider-native request params. Callers use the provider-native request shape directly.

### OpenAI Responses request construction

The provider should build request params in this order:

1. Start with pass-through request params cloned from plugin options.
2. Overlay runtime-required fields owned by `poe-agent`: `model`, `input`, `tools`, and streaming behavior.
3. Preserve the existing default `include: ["reasoning.encrypted_content"]` only when the caller did not supply `include`.
4. Send the result to `openai.responses.stream(...)`.

`model`, `input`, and `tools` are not arbitrary pass-through fields for `poe-agent` runs because the runtime owns conversation serialization and tool registration. If a caller supplies those fields in plugin options:

- `model` is consumed as provider model metadata.
- `input` is rejected as a `poe-agent` configuration error because `.run(prompt)` owns input.
- `tools` is rejected as a `poe-agent` configuration error because `.tools(...)`, `.use(...)`, and `.mcp(...)` own tools.

Use a clear `poe-agent` configuration error so user-supplied runtime-owned params are not silently dropped.

### OpenAI Chat Completions parity

Apply the same pattern to `openaiChatCompletionsPlugin(...)`:

```ts
agent().use(
  openaiChatCompletionsPlugin({
    model: "anthropic/claude-sonnet-4.6",
    temperature: 0.2
  })
);
```

Chat Completions request params pass through to `openai.chat.completions.create(...)` without an allowlist. Runtime-owned fields are `model`, `messages`, `tools`, `stream`, and `stream_options`.

This avoids making OpenAI Responses a one-off and establishes the provider-plugin convention.

### Config-file plugins

`resolvePluginsFromConfig(...)` currently calls each `PluginSpec.parseOptions(...)`, and built-in OpenAI plugin specs reject unknown keys. Update only the OpenAI provider specs so config-file plugin options also accept pass-through request params:

```ts
{
  name: "openai-responses",
  options: {
    model: "gpt-5.5",
    reasoning: { effort: "high" },
    text: { verbosity: "medium" }
  }
}
```

Keep strict `agent.plugins[*]` entry validation (`name`, `options`) because that is `poe-agent` config shape, not provider request shape.

### Edge cases

- Empty string `model` in plugin options: treat as absent, matching `.model("")` normalization.
- Multiple configured provider models: throw before provider selection.
- `.model(...)` plus provider `model`: throw before provider selection.
- `options.acpModel` plus provider `model`: provider model is still useful for spawn identity, but the injected `AcpModel` is the actual model. Preserve current injected-model behavior unless tests show existing callers depend on `.model(...)` with `acpModel`.
- Provider-native invalid params: pass through; provider/API error is the source of truth.
- Existing repo-specific OpenAI option aliases are not carried forward into the new pass-through request-param contract.

## 4. Interfaces and test plan

### Public types

Update [packages/poe-agent/src/runtime/plugin-types.ts](/Users/kjopek/Workspace/poe-code/packages/poe-agent/src/runtime/plugin-types.ts):

```ts
export type Provider = {
  name: string;
  model?: string;
  supports(modelId: string): boolean;
  createModel(modelId: string, ctx: ProviderContext): AcpModel | Promise<AcpModel>;
};
```

Update [packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.ts](/Users/kjopek/Workspace/poe-code/packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.ts):

```ts
export type OpenaiResponsesPluginOptions =
  OpenaiResponsesClientOptions &
  OpenaiResponsesRequestOptions;
```

Update [packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.ts](/Users/kjopek/Workspace/poe-code/packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.ts) with equivalent client/request option separation.

### Unit tests

Add or update tests in [packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.test.ts](/Users/kjopek/Workspace/poe-code/packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.test.ts):

- `spec.parseOptions(...)` preserves unknown provider request params instead of throwing.
- `openaiResponsesPlugin({ model })` sets provider `model`.
- Provider-native request params are forwarded to `openai.responses.stream(...)`.
- `include` defaults to `["reasoning.encrypted_content"]` only when omitted.
- Caller-supplied `include` is preserved.
- Provider-native `reasoning` is forwarded unchanged.
- Runtime-owned `input` and `tools` in plugin options throw a clear configuration error.

Add or update tests in [packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.test.ts](/Users/kjopek/Workspace/poe-code/packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.test.ts):

- `spec.parseOptions(...)` preserves unknown provider request params.
- `openaiChatCompletionsPlugin({ model })` sets provider `model`.
- Provider-native request params are forwarded to `openai.chat.completions.create(...)`.
- Runtime-owned `messages`, `tools`, `stream`, and `stream_options` in plugin options throw a clear configuration error.

Add or update tests in [packages/poe-agent/src/agent.test.ts](/Users/kjopek/Workspace/poe-code/packages/poe-agent/src/agent.test.ts):

- `agent().use(providerPluginWithModel).run(...)` runs without `.model(...)`.
- `.model(...)` plus provider `model` throws before `createModel(...)`.
- Two providers with configured models throw before `createModel(...)`.
- Existing `.model(...).use(openaiResponsesPlugin())` still works.
- Existing injected `acpModel` tests still work.

### Real-world test

Use a deterministic SDK-level run first:

```sh
npm run test:unit --workspace @poe-code/poe-agent -- poe-agent-plugin-openai-responses.test.ts poe-agent-plugin-openai-chat-completions.test.ts agent.test.ts
```

Expected output: all targeted tests pass, including provider-model tests and pass-through param assertions.

Then run package type/build validation:

```sh
npm run build --workspace @poe-code/poe-agent
```

Expected output: TypeScript build passes and `dist/SYSTEM_PROMPT.md` is copied.

If the implementation changes CLI-visible help or output, run:

```sh
npm run screenshot-poe-code -- --help
```

Expected observation: CLI output still renders correctly. This plan should not change CLI visuals, so screenshot validation is only required if the implementation touches CLI rendering or help text.

### Must-work checklist

- [ ] `agent().use(openaiResponsesPlugin({ model: "gpt-5.5" })).run("hello")` resolves a model without `.model(...)`; proved by `agent.test.ts`.
- [ ] `reasoning: { effort: "high" }` is forwarded as provider-native request data; proved by OpenAI Responses plugin test inspecting `responses.stream` args.
- [ ] Unknown provider request params are not rejected by `spec.parseOptions(...)`; proved by OpenAI plugin config tests.
- [ ] Runtime-owned `input` / `tools` for Responses and `messages` / `tools` / `stream` / `stream_options` for Chat Completions fail clearly; proved by plugin tests.
- [ ] Existing `.model(...).use(openaiResponsesPlugin())` behavior remains green; proved by existing and updated `agent.test.ts`.
- [ ] `.model(...)` plus plugin `model` fails before provider request; proved by `agent.test.ts`.
- [ ] Two provider plugins with configured `model` fail before provider request; proved by `agent.test.ts`.
- [ ] `npm run build --workspace @poe-code/poe-agent` passes.

## 5. Code plan

### Files to change

- [packages/poe-agent/src/runtime/plugin-types.ts](/Users/kjopek/Workspace/poe-code/packages/poe-agent/src/runtime/plugin-types.ts)
  - Add optional `model?: string` to `Provider`.

- [packages/poe-agent/src/agent.ts](/Users/kjopek/Workspace/poe-code/packages/poe-agent/src/agent.ts)
  - Collect providers before resolving `modelName`.
  - Add a helper that resolves model source from builder config, provider metadata, and injected `acpModel`.
  - Throw on duplicate model sources.
  - Keep provider selection through `resolveProvider(providers, modelName)`.

- [packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.ts](/Users/kjopek/Workspace/poe-code/packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.ts)
  - Split client options from provider request params.
  - Stop rejecting unknown provider request params.
  - Add provider `model` metadata from options.
  - Forward pass-through request params into `openai.responses.stream(...)`.
  - Preserve default `include` only when omitted.
  - Reject runtime-owned request fields `input` and `tools` if supplied in plugin options.

- [packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.ts](/Users/kjopek/Workspace/poe-code/packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.ts)
  - Apply the same model metadata and pass-through request-param pattern.
  - Reject runtime-owned request fields `messages`, `tools`, `stream`, and `stream_options` if supplied in plugin options.

- [packages/poe-agent/src/plugins/parse-options.ts](/Users/kjopek/Workspace/poe-code/packages/poe-agent/src/plugins/parse-options.ts)
  - Add small object helpers only if they reduce duplication for splitting client options from request params. Do not add provider-specific validation here.

- [packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.test.ts](/Users/kjopek/Workspace/poe-code/packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.test.ts)
  - Add TDD coverage for pass-through options, provider model metadata, defaults, and reserved runtime-owned fields.

- [packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.test.ts](/Users/kjopek/Workspace/poe-code/packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.test.ts)
  - Add TDD coverage for pass-through options, provider model metadata, and reserved runtime-owned fields.

- [packages/poe-agent/src/agent.test.ts](/Users/kjopek/Workspace/poe-code/packages/poe-agent/src/agent.test.ts)
  - Add TDD coverage for provider-owned model resolution and duplicate model-source errors.

- [packages/poe-agent/README.md](/Users/kjopek/Workspace/poe-code/packages/poe-agent/README.md)
  - Update only after explicit user permission. Document provider-owned model config and pass-through request params.

### Signatures and helpers

Add a generic model resolver in [agent.ts](/Users/kjopek/Workspace/poe-code/packages/poe-agent/src/agent.ts):

```ts
type ModelSource =
  | { kind: "builder"; model: string }
  | { kind: "provider"; providerName: string; model: string }
  | { kind: "injected"; model: "injected-acp-model" };

function resolveModelSource(input: {
  builderModel?: string;
  providers: Provider[];
  acpModel?: AcpModel;
}): ModelSource;
```

Add option splitting helpers near the OpenAI plugins, not as core abstractions unless both plugins share enough code to justify it:

```ts
function splitOpenaiResponsesOptions(
  options: Record<string, unknown>
): {
  clientOptions: OpenaiResponsesClientOptions;
  requestParams: Record<string, unknown>;
  model?: string;
};
```

Use explicit runtime-owned key sets in provider plugin files:

```ts
const OPENAI_RESPONSES_RUNTIME_OWNED_REQUEST_KEYS = ["input", "tools"] as const;
const OPENAI_CHAT_RUNTIME_OWNED_REQUEST_KEYS = [
  "messages",
  "tools",
  "stream",
  "stream_options"
] as const;
```

These constants represent repo-owned contract boundaries, not provider allowlists.

### Build order

1. Add failing tests for provider-owned model resolution in `agent.test.ts`.
2. Add `Provider.model` and implement generic model-source resolution in `agent.ts`.
3. Add failing OpenAI Responses tests for pass-through params and reserved runtime-owned fields.
4. Refactor OpenAI Responses option parsing and request construction.
5. Add failing OpenAI Chat Completions tests for parity.
6. Refactor OpenAI Chat Completions option parsing and request construction.
7. Run targeted tests.
8. Run package build.
9. If user explicitly approves README edits, update `packages/poe-agent/README.md` and re-run package build.
