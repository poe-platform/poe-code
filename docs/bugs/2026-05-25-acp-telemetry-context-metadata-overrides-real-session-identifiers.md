# ACP telemetry context metadata overrides real session identifiers

## Summary

`@poe-code/acp-telemetry` builds an agent trace root using the actual `sessionId` and `threadId` from the spawn context, then spreads optional caller metadata afterward. Metadata fields named `sessionId` or `threadId` overwrite the authoritative identifiers, and OpenTelemetry emission publishes the substituted values as trace correlation attributes.

## Reproduction

Create the disposable probe `packages/acp-telemetry/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { acpToTrace } from './trace.js';
import { emitToOtel } from './emit-otel.js';
import type { AcpSpawnContext } from '@poe-code/agent-spawn';

describe('ACP trace metadata identifier override', () => {
  it('emits metadata-supplied identifiers instead of the actual spawn session identifiers', () => {
    const ctx = {
      agent: 'codex',
      model: 'gpt-5',
      prompt: 'hello',
      mode: 'edit',
      cwd: '/repo',
      events: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      sessionId: 'real-session',
      threadId: 'real-thread',
      metadata: { sessionId: 'spoofed-session', threadId: 'spoofed-thread' },
    } as AcpSpawnContext & { metadata: Record<string, unknown> };
    const attrs = vi.fn();

    emitToOtel(acpToTrace(ctx), {
      startSpan: vi.fn(() => ({
        setAttribute: vi.fn(),
        setAttributes: attrs,
        end: vi.fn(),
      })),
    });

    expect(attrs).toHaveBeenCalledWith(expect.objectContaining({
      'poe_code.session_id': 'spoofed-session',
      'poe_code.thread_id': 'spoofed-thread',
    }));
  });
});
```

Run:

```sh
npm exec -- vitest run packages/acp-telemetry/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/acp-telemetry/src/__probe__.test.ts > ACP trace metadata identifier override > emits metadata-supplied identifiers instead of the actual spawn session identifiers
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`acpToTrace()` creates root metadata with `sessionId: ctx.sessionId` and `threadId: ctx.threadId`, but immediately applies `...spawnCtx.metadata` after those properties at `packages/acp-telemetry/src/trace.ts:39` through `packages/acp-telemetry/src/trace.ts:43`. `emitToOtel()` then reads the resulting metadata fields into `poe_code.session_id` and `poe_code.thread_id` attributes at `packages/acp-telemetry/src/emit-otel.ts:46` through `packages/acp-telemetry/src/emit-otel.ts:54`. In the probe, the context identifies `real-session` and `real-thread`, yet telemetry attributes contain `spoofed-session` and `spoofed-thread` supplied only as extra metadata.

## Expected Behavior

Authoritative session and thread identifiers should be preserved from the spawn context and must not be replaceable by optional supplemental metadata. If arbitrary metadata includes reserved identifier keys, those keys should be rejected, renamed, or ignored for correlation attributes.

## Impact

Telemetry consumers can receive spans attributed to the wrong session or thread, corrupting run correlation, debugging timelines, cost attribution, and audit trails. Middleware or agent-supplied metadata can make a real execution appear connected to another trace identity while the underlying spawn context records a different session.
