# Codex OpenAI Provider Configure Investigation

Running investigation note for adding first-party OpenAI provider support to `poe-code configure codex`.

## Current Status

- `poe-code configure <agent>` is already provider-driven. It resolves a compatible auth provider from `ProviderRegistry.forAgent(agent)`, an explicit `--provider`, or `POE_CODE_PROVIDER`.
- Codex configuration is generic over provider API shape for custom providers. `src/providers/codex.ts` writes `model_provider`, optional `model` / profile fields, and for custom providers writes `model_providers.<providerId>.base_url` plus credential fields from the active provider context.
- First-party OpenAI provider support is implemented in `packages/providers/src/providers/openai.ts` with `id: "openai"`, `baseUrl: "https://api.openai.com/v1"`, `auth.envVar: "OPENAI_API_KEY"`, and API shapes `openai-responses` plus `openai-chat-completions`.
- The first-party provider registry is generated from `packages/providers/src/providers/*.ts` through `packages/providers/scripts/generate-provider-registry.mjs`, so future provider additions do not require manual registry edits.
- The isolated workspace `.env` e2e support and the focused Codex/OpenAI e2e were removed by request. First-party OpenAI provider functionality remains covered by package/provider tests rather than e2e workspace `.env` loading.
- `poe-code configure codex --yes --provider openai` now prompts for the OpenAI API key when neither `--api-key`, `OPENAI_API_KEY`, nor a stored provider credential is available. `--yes` accepts defaults, but it does not silently skip a required secret.
- Codex configure no longer declares or maintains a default model. `--model` remains an optional CLI/SDK value; when omitted, Codex config omits `model` and profile entries so the Codex CLI can use its own behavior.
- Codex configure no longer prompts for or writes a default reasoning effort. `model_reasoning_effort` is omitted unless the existing `--reasoning-effort` option or provider API input supplies an explicit value.
- Codex treats first-party `openai` as a reserved built-in provider ID. `poe-code configure codex --provider openai` writes `model_provider = "openai"` and `forced_login_method = "api"`, omits `[model_providers.openai]`, and does not embed `experimental_bearer_token` or `base_url`.
- First-party OpenAI Codex auth uses `codex login --with-api-key` with the resolved OpenAI credential sent on stdin. `CODEX_HOME` is set to the configured Codex home so global and isolated config paths use Codex's supported auth store/keyring behavior.

## Findings From Explorers

### Configure and Provider Flow

- `src/cli/commands/configure.ts` resolves providers before building the configure payload. Explicit provider selection validates that the provider exists and supports the agent's API shape.
- `src/cli/commands/configure-payload.ts` resolves credentials through the selected provider. Poe keeps its OAuth/API-key preference path; non-Poe providers use `ProviderRegistry.resolveCredential`.
- `src/cli/commands/shared.ts` builds `ActiveProvider` by resolving the agent-compatible API shape, base URL, agent base URL, credential, model input behavior, and provider-derived env.
- `src/providers/codex.ts` receives `options.provider.id`, `options.provider.baseUrl`, `options.provider.credential`, and `options.provider.modelInput`. The only provider-ID-specific logic retained there is the Codex schema reserved-ID check for built-in `openai`.
- Custom providers such as Poe and Cloudflare keep using the generated `[model_providers.<id>]` table with `base_url`, `wire_api = "responses"`, and credential fields.

### E2E Isolation and Env

- E2E tests use `@poe-code/e2e-test-runner` and `useContainer()`, with fresh `HOME` / XDG isolation per test.
- The e2e runner requires `POE_API_KEY` from the explicit environment/auth store path and injects it into host or container backends. It does not load workspace `.env` files.
- Adding OpenAI-backed e2e coverage would need an explicit decision about `OPENAI_API_KEY`: either require it for a focused OpenAI e2e path or keep e2e on Poe and cover OpenAI provider behavior with unit tests.
- Current `e2e/codex.test.ts` verifies `poe-code configure codex --yes`, generated `~/.codex/config.toml`, `poe-code test codex`, isolated test mode, and hook bridging. Any new e2e should follow that pattern and use `container.home`, not hardcoded paths.

### Docs and Plan Conventions

- Planning and investigation docs belong under `docs/plans`; QA checklists can live under `docs/plans/qa`.
- Existing full plans often use schema frontmatter, while shorter investigation/QA notes use plain Markdown. This file is intentionally a short living investigation note.
- Package README updates are required for provider package changes, including newly exposed env variables and provider manifest/config options.
- Do not change the root README without explicit user permission.

## Decisions

- Keep the implementation declarative: provider details live in `packages/providers/src/providers/openai.ts`; public exports and `allAuthProviders` are derived by the generated provider barrel.
- Do not add general provider branching keyed on OpenAI. The existing API-shape compatibility mechanism selects OpenAI for Codex through `openai-responses`; Codex-specific reserved built-in provider handling is scoped to the Codex config/auth schema.
- Use `OPENAI_API_KEY` as the provider env var and `provider:openai` as the credential storage key, matching existing tests.
- Preserve CLI/SDK parity by relying on the shared provider registry used by both containers.
- E2E coverage should not require a real OpenAI secret. The temporary isolated workspace `.env` support and its Codex/OpenAI e2e were deleted by request, so OpenAI provider verification should remain in unit/package coverage unless a separate explicit-env e2e is approved.
- Explicit provider configure should authenticate missing credentials through the provider registry before payload creation. This keeps the behavior provider-driven and avoids OpenAI-specific branching.
- Codex model selection is opt-in only. A supplied `--model` is written to `~/.codex/config.toml`; no supplied model means no `model` key, no Codex profile block, and no stored configured model metadata.
- Codex reasoning effort is opt-in only. A supplied reasoning effort is written to `~/.codex/config.toml`; no supplied value means no `model_reasoning_effort` key so Codex owns its default behavior.
- First-party OpenAI credentials are not written to Codex TOML. `codex login --with-api-key` is the persistent setup path; the secret is sent through stdin, never argv.

## Risks

- `allAuthProviders` ordering is now generic: OAuth-preferred providers first, then normal API-key providers by id, then providers that require an explicit base URL. If multiple compatible providers are logged in for Codex, `configure --yes` remains ambiguous and requires `--provider`; interactive mode prompts.
- `baseUrl` path handling is sensitive. OpenAI's declared base URL is already the shape endpoint (`https://api.openai.com/v1`) and should not append another `/v1`.
- E2E workspace `.env` parsing is intentionally not supported after the cleanup request. Host and persistent container execution use the prior explicit-env/process-env behavior.
- Built CLI verification requires the root bundle to be rebuilt after provider package changes; stale `dist/index.js` was the cause of the prior `Unknown provider "openai"` failure.
- Codex without an explicit `--model` now depends on the installed Codex CLI's own model behavior. This is intentional; poe-code no longer owns a Codex model default.
- Codex without an explicit `--reasoning-effort` now depends on the installed Codex CLI's own reasoning-effort behavior. This is intentional; poe-code no longer owns a Codex reasoning-effort default.

## Verification

- `node node_modules/vitest/vitest.mjs run src/cli/commands/configure.test.ts` - passed.
- `node node_modules/vitest/vitest.mjs run src/providers/providers.test.ts src/services/services.test.ts src/sdk/spawn.test.ts` - passed.
- `node node_modules/vitest/vitest.mjs run src/cli/commands/configure-payload.test.ts packages/providers/src` - passed.
- `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit` - passed.
- `npm run test:unit -- packages/providers/src` - passed.
- `PATH=/Applications/Open\ Design.app/Contents/Resources/open-design/bin:$PATH /Applications/Open\ Design.app/Contents/Resources/open-design/bin/node node_modules/vitest/vitest.mjs run packages/e2e-test-runner/src` - passed after cleanup.
- `PATH=/Applications/Open\ Design.app/Contents/Resources/open-design/bin:$PATH /Applications/Open\ Design.app/Contents/Resources/open-design/bin/node node_modules/vitest/vitest.mjs run packages/providers/src` - passed after cleanup.
- `PATH=/Applications/Open\ Design.app/Contents/Resources/open-design/bin:$PATH /Applications/Open\ Design.app/Contents/Resources/open-design/bin/node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit` - passed after cleanup.
- `/Applications/Open\ Design.app/Contents/Resources/open-design/bin/node node_modules/vitest/vitest.mjs run src/cli/commands/configure.test.ts` - passed after Codex reasoning-effort prompt removal.
- `/Applications/Open\ Design.app/Contents/Resources/open-design/bin/node node_modules/vitest/vitest.mjs run src/providers/providers.test.ts` - passed after Codex reasoning-effort prompt removal.
- `/Applications/Open\ Design.app/Contents/Resources/open-design/bin/node node_modules/vitest/vitest.mjs run src/cli/commands/configure-payload.test.ts src/cli/commands/ensure-isolated-config.test.ts src/cli/commands/login.test.ts src/cli/commands/provider.test.ts src/cli/cli-scripts.test.ts` - passed after Codex reasoning-effort prompt removal.
- `/Applications/Open\ Design.app/Contents/Resources/open-design/bin/node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit` - passed after Codex reasoning-effort prompt removal.
- `/Applications/Open\ Design.app/Contents/Resources/open-design/bin/node node_modules/vitest/vitest.mjs run src/cli/commands/configure.test.ts` - passed after Codex built-in OpenAI provider auth fix.
- `/Applications/Open\ Design.app/Contents/Resources/open-design/bin/node node_modules/vitest/vitest.mjs run src/providers/providers.test.ts` - passed after Codex built-in OpenAI provider auth fix.
- `/Applications/Open\ Design.app/Contents/Resources/open-design/bin/node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit` - passed after Codex built-in OpenAI provider auth fix.
- `npm run build` - passed and refreshed the bundled CLI.
- Removed by request: `E2E_BACKEND=env npm run e2e:verbose -- e2e/codex.test.ts -t "codex with first-party OpenAI provider"`.
