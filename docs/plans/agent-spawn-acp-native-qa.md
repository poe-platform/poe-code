# ACP native mock-agent QA

Exercise the public `spawnStreaming` pipeline with actual Node child processes
running `packages/agent-spawn/src/acp/__fixtures__/mock-agent.mjs`. Use the fixture
`sample-sessions.json` in that directory as the expected event source. The fast
integration suite keeps all six pipeline assertions with the maintained mock
process runner; this plan preserves the original native subprocess controls.

Use the ordinary source runtime and host execution factory. Resolve the test
agent config with binary `process.execPath`, the fixture executable as
`promptFlag`, CLI kind, no default arguments, and empty yolo/auto/edit/read mode
arguments. Use codex and claude adapters for their corresponding fixture modes,
and the native adapter for `native-empty`. Strip provider prefixes for the codex
and claude configurations. Use the same repository cwd as the original test.
Do not invoke an LLM or a real provider CLI.

Run every scenario under the original five-second deadline, without increasing
the stack or deadline. Collect the events and await `done`; remove only owned
resources if execution fails. A timeout fails this QA.

1. **Codex events:** start codex with prompt `codex`. Require exit zero and exactly
   the fixture's `fromCodex` event order/count. Normalize expected `output` to
   `path` where no path is present, and turn literal escaped newlines in expected
   paths into newlines. Require every event to contain all expected fields.
2. **Native OTLP metadata:** start codex with capture enabled and a consumer
   middleware that records metadata after awaiting `next()`. Use the original
   controlled capture port: no extra args/env, correlation ID
   `test-native-otel-correlation-id`, and a drain result containing one traces
   record with `application/json` and `resourceSpans: [{ scopeSpans: [] }]`.
   Require exit zero and that the consumer sees the correlation ID and exact
   drained native record before middleware completion.
3. **Claude events:** start claude-code with prompt `claude`. Require exit zero,
   the exact normalized `fromClaude` event order/count and every expected field.
4. **Inherited event:** temporarily add `event=polluted` to `Object.prototype`
   while running the native adapter with prompt `native-empty`. Require no events
   and exit zero. Restore the original property descriptor in all outcomes.
5. **Renderer pipeline:** tap the codex event stream and send it through the
   actual `renderAcpStream`, using controlled design renderer sinks. Require:
   tool start/complete for exec `ls -la`; tool start/complete for edit
   `src/config.ts`; tool start for think `thinking...`; reasoning
   `I need to update the imports after the file edit.`; agent message
   `I've updated the configuration file with the new settings.`; and usage
   `{ input: 1500, output: 350, cached: 800, costUsd: undefined }`, in that order.
   Require first captured event `session_start`, an `agent_message`, and exit zero.
6. **Failure:** start the codex adapter with prompt `fail`. Require no events,
   exit exactly two, and stderr containing `mock agent failed`.

All six original native cases and assertions passed unchanged on 27 September
2026 in 2193 ms total with the original deadlines. Full and maintained focused
runs separately reproduced variable subprocess delays and five-second timeouts;
the unit suite now controls process streams without changing production code or
discarding these native assertions.
