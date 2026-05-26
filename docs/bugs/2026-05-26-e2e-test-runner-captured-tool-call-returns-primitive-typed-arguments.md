# E2E test runner captured tool call returns primitive typed arguments

## Summary

The exported `@poe-code/e2e-test-runner` `CapturedRequests.toolCallsAt()` API declares each decoded tool-call `arguments` value as `Record<string, unknown>`, but parses captured model response JSON without checking that the result is an object. A captured response containing tool arguments JSON such as `"7"` therefore returns the primitive number `7` as a typed argument object.

## Reproduction

From the repository root, create and run this disposable probe, then remove it:

```ts
import { describe, expect, it } from 'vitest';
import { CapturedRequests } from './index.js';

describe('captured request tool-call argument validation', () => {
  it('returns primitive parsed arguments as a typed argument object', () => {
    const requests = new CapturedRequests([
      {
        timestamp: '2026-05-26T00:00:00.000Z',
        route: '/v1/chat/completions',
        request: { method: 'POST', path: '/v1/chat/completions', headers: {}, body: {} },
        response: {
          status: 200,
          body: {
            choices: [{ message: { tool_calls: [{ function: { name: 'read_file', arguments: '7' } }] } }],
          },
        },
      },
    ]);

    const [toolCall] = requests.toolCallsAt(0);

    expect(toolCall?.arguments).toBe(7);
  });
});
```

```sh
cat > packages/e2e-test-runner/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from 'vitest';
import { CapturedRequests } from './index.js';

describe('captured request tool-call argument validation', () => {
  it('returns primitive parsed arguments as a typed argument object', () => {
    const requests = new CapturedRequests([
      {
        timestamp: '2026-05-26T00:00:00.000Z',
        route: '/v1/chat/completions',
        request: { method: 'POST', path: '/v1/chat/completions', headers: {}, body: {} },
        response: {
          status: 200,
          body: {
            choices: [{ message: { tool_calls: [{ function: { name: 'read_file', arguments: '7' } }] } }],
          },
        },
      },
    ]);

    const [toolCall] = requests.toolCallsAt(0);

    expect(toolCall?.arguments).toBe(7);
  });
});
EOF
npm exec -- vitest run packages/e2e-test-runner/src/__probe__.test.ts --reporter verbose
rm packages/e2e-test-runner/src/__probe__.test.ts
```

The probe passes while observing a primitive value through the typed object field:

```text
✓ packages/e2e-test-runner/src/__probe__.test.ts > captured request tool-call argument validation > returns primitive parsed arguments as a typed argument object
```

## Observed Behavior

`packages/e2e-test-runner/src/index.ts:12` publicly exports `CapturedRequests`. `toolCallsAt()` is implemented at `packages/e2e-test-runner/src/proxy-requests.ts:90` through `packages/e2e-test-runner/src/proxy-requests.ts:104` and advertises results shaped as `{ name: string; arguments: Record<string, unknown> }`. For each captured model tool call, the method runs `JSON.parse(argumentsJson) as Record<string, unknown>` with no runtime object validation. In the reproduction, the captured arguments text is valid JSON but represents the number `7`, and the API returns `{ name: "read_file", arguments: 7 }` despite its object-typed contract.

## Expected Behavior

`toolCallsAt()` should validate decoded tool arguments before returning its typed result. JSON values that are not object records should be rejected with a clear malformed-capture error or excluded through an explicitly documented invalid-entry policy, rather than cast into the successful object result type.

## Impact

E2E assertions and diagnostic utilities can trust `toolCallsAt()` results and immediately inspect fields such as `toolCall.arguments.path`. A malformed, stale, or model-produced capture containing primitive arguments crosses the public API as apparently valid typed data, shifting validation failures into test logic and potentially causing misleading assertion failures, crashes, or missed checks of the intended tool invocation.
