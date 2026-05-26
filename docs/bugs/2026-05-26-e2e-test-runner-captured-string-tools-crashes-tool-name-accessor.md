# E2E test runner captured string tools crashes tool-name accessor

## Summary

The exported `@poe-code/e2e-test-runner` `CapturedRequests.toolNamesAt()` helper assumes that a captured request body `tools` member is an array. If captured JSON instead contains a present string value such as `"not-an-array"`, the public accessor calls `.map()` on that string and throws an internal `TypeError` rather than reporting malformed capture input.

## Reproduction

From the repository root, create and run this disposable probe, then remove it:

```ts
import { describe, expect, it } from 'vitest';
import { CapturedRequests } from './index.js';

describe('captured request tool definition validation', () => {
  it('throws implementation TypeError when captured tools is a string', () => {
    const requests = new CapturedRequests([
      {
        timestamp: '2026-05-26T00:00:00.000Z',
        route: '/v1/chat/completions',
        request: {
          method: 'POST', path: '/v1/chat/completions', headers: {}, body: { tools: 'not-an-array' },
        },
        response: { status: 200, body: {} },
      },
    ]);

    expect(() => requests.toolNamesAt(0)).toThrow('map is not a function');
  });
});
```

```sh
cat > packages/e2e-test-runner/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from 'vitest';
import { CapturedRequests } from './index.js';

describe('captured request tool definition validation', () => {
  it('throws implementation TypeError when captured tools is a string', () => {
    const requests = new CapturedRequests([
      {
        timestamp: '2026-05-26T00:00:00.000Z',
        route: '/v1/chat/completions',
        request: {
          method: 'POST', path: '/v1/chat/completions', headers: {}, body: { tools: 'not-an-array' },
        },
        response: { status: 200, body: {} },
      },
    ]);

    expect(() => requests.toolNamesAt(0)).toThrow('map is not a function');
  });
});
EOF
npm exec -- vitest run packages/e2e-test-runner/src/__probe__.test.ts --reporter verbose
rm packages/e2e-test-runner/src/__probe__.test.ts
```

The probe passes while asserting the internal accessor crash:

```text
✓ packages/e2e-test-runner/src/__probe__.test.ts > captured request tool definition validation > throws implementation TypeError when captured tools is a string
```

## Observed Behavior

`packages/e2e-test-runner/src/index.ts:13` publicly exports `CapturedRequests`. In `packages/e2e-test-runner/src/proxy-requests.ts:83` through `packages/e2e-test-runner/src/proxy-requests.ts:88`, `toolNamesAt()` casts the captured request body to its expected internal shape and evaluates `(requestBody?.tools ?? []).map(...)` without checking `Array.isArray(requestBody.tools)`. The public `CapturedExchange` input type exposes request bodies only as `unknown`, so callers can legitimately construct a collection from unvalidated captured JSON. Given `{ tools: "not-an-array" }`, `toolNamesAt(0)` throws `TypeError: ...map is not a function`.

## Expected Behavior

The captured-request inspection API should validate optional request `tools` data before mapping tool definitions. A malformed non-array member should yield a clear invalid-capture diagnostic or a documented empty result policy instead of throwing from unchecked internal assumptions.

## Impact

Tests and troubleshooting code use captured-request helpers to explain what tools were exposed to a model. A corrupted snapshot, unexpected upstream payload, or manually constructed capture can make a diagnostic read itself crash with an implementation error, hiding the malformed fixture source and preventing assertions or reporting from examining other captured exchanges.
