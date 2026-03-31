import { describe, expect, expectTypeOf, it } from 'bun:test';
import {
  CapturedRequests,
  runPreflight,
  useContainer,
} from '@poe-code/e2e-docker-test-runner';
import type { CapturedExchange } from '@poe-code/e2e-docker-test-runner';

type ExchangeOverrides = {
  request?: Partial<CapturedExchange['request']>;
  response?: Partial<CapturedExchange['response']>;
};

function createExchange(overrides: ExchangeOverrides = {}): CapturedExchange {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    route: '/v1/chat/completions',
    request: {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {
        'content-type': 'application/json',
      },
      body: {
        model: 'Claude-Haiku-4.5',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [{ function: { name: 'mcp__test-server__word_of_the_day' } }],
      },
      ...overrides.request,
    },
    response: {
      status: 200,
      body: {
        choices: [{ message: { content: 'Done' } }],
      },
      ...overrides.response,
    },
  };
}

describe('package root exports', () => {
  it('exports CapturedRequests class and CapturedExchange type', () => {
    const requests = new CapturedRequests([createExchange()]);

    expect(requests.length).toBe(1);
    expectTypeOf<CapturedExchange>().toEqualTypeOf<{
      timestamp: string;
      route: string;
      request: {
        method: string;
        path: string;
        headers: Record<string, string>;
        body: unknown;
      };
      response: {
        status: number;
        body: unknown;
      };
    }>();
  });

  it('keeps existing API exports accessible from package root', () => {
    expectTypeOf(useContainer).toBeFunction();
    expectTypeOf(runPreflight).toBeFunction();
  });

  it('registers proxy matchers via package root side effects', () => {
    expect(createExchange()).toHaveToolInRequest('mcp__test-server__word_of_the_day');
  });
});
