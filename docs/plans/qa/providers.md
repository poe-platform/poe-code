# Providers QA

## Smoke test

1. Ensure the shell has a real Poe API key available to `poe-agent`.
2. Pick an available text model from `poe-code models --endpoint /v1/responses`.
3. Run `npx poe-agent run --model <model-id> --prompt "Say hi"`.
4. Assert the command completes without error and prints assistant text output.

## `--model` override beats config

1. Set `agent.model` in the active Poe config to one available model.
2. Pick a different available text model for the CLI override.
3. Run `npx poe-agent run --model <override-model-id> --prompt "Say hi"`.
4. Assert the request log or usage event shows `<override-model-id>`, not the configured model.

## Missing provider match

1. Run `npx poe-agent run --model nonexistent-model --prompt "hi"`.
2. Assert the error message contains `No provider supports model`.
3. Assert the same message contains `nonexistent-model`.
4. Assert the same message lists the registered provider names in registration order.

## OpenAI Responses reasoning round-trip

1. Start an o-series run with a prompt that forces two back-to-back tool calls before the final answer.
2. Run `npx poe-agent run --model <reasoning-model-id> --prompt "Use tools twice in a row before answering. After the second tool result, explain how it changed your answer and keep referring to the same reasoning chain."`.
3. Assert the first tool-use turn emits `reasoning_details` refs.
4. Assert the second tool-use turn preserves those refs and adds any new refs without dropping the earlier ones.
5. Assert the final response still references the prior reasoning correctly after both tool-use turns.

## `poe-agent --help` screenshot

1. Run `npm run screenshot-poe-code -- --help`.
2. Assert the saved screenshot shows `--model` in help output.
3. Assert the saved screenshot formatting is aligned and readable.

## `poe-agent run --help` screenshot

1. Run `npm run screenshot-poe-code -- run --help`.
2. Assert the saved screenshot shows `--model` in help output.
3. Assert the saved screenshot formatting is aligned and readable.

## Final acceptance sweep

1. Run `npx vitest run packages/poe-agent`.
2. Assert all tests pass. Confirmed on 2026-04-20: 24 files passed and 304 tests passed.
3. Run `npx tsc --noEmit`.
4. Assert the command reports no diagnostics. Result on 2026-04-20: not clean; repo-wide TypeScript diagnostics remain outside this doc change.
5. Run `npm run lint`.
6. Assert the command is clean. Result on 2026-04-20: exit code 0, but ESLint reported 4 warnings, so not fully clean.
7. Run `grep -R "sanitizeToolName\|INVALID_TOOL_NAME_CHAR\|originalByApiName\|createPoeAcpModel" packages/`.
8. Assert no matches are printed. Confirmed on 2026-04-20: zero matches.
9. Run `test -d packages/poe-agent/src/models`.
10. Assert the directory is absent. Confirmed on 2026-04-20: directory absent.
