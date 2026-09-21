# Poe ACP Client Rust

Run ACP agents from Node with an independent Rust protocol core and no npm runtime dependencies. This additive package preserves the original client API and ships its native addon in the package.

- Initialize, authenticate, create or load sessions, and stream prompt updates.
- Handle permissions, files, terminals, and extension methods.
- Parse ACP messages, summarize tool calls and usage, and save redacted run reports.
- Dispose owned subprocesses with bounded stderr and escalating shutdown.

```typescript
import { AcpClient } from '@poe-code/poe-acp-client-rust';

const client = new AcpClient({ command: 'my-acp-agent', autoApprove: true });
try {
  await client.initialize();
  const { sessionId } = await client.newSession(process.cwd(), []);
  const turn = client.prompt(sessionId, [{ type: 'text', text: 'Explain this project' }]);
  for await (const notification of turn) {
    console.log(notification.params.update);
  }
  console.log(await turn.response);
} finally {
  await client.dispose();
}
```

Injected transports and capability handlers use the same public contracts as `@poe-code/poe-acp-client`. Rust owns protocol validation, client admission, request correlation, stream aggregation and report policies; Node supplies streams, subprocesses, dates, filesystem and crypto effects.

Structural notification accessors are rejected without invocation. Opaque tool payloads and metadata stay in the host, so streamed updates preserve object identity without requiring those payloads to be JSON serializable. Incoming frames are limited to 8 Mi UTF-16 units; stderr retains the last 65,536 units. Prompt queues retain unread updates until consumed, matching the original client, and are not bounded by a configured queue limit.

This package is private and experimental. Existing consumers continue to use the original implementation. Current native artifact checks cover macOS arm64; other platform artifacts, Python bindings and broad performance acceptance remain pending. Rust does not guarantee faster execution or lower memory use at the Node boundary.
