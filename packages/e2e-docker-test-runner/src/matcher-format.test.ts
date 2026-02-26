import { describe, expect, it } from 'vitest';
import { formatExchangeContext, formatExchangeList } from './matcher-format.js';
import type { CapturedExchange } from './proxy-types.js';

type ExchangeOverrides = {
  timestamp?: string;
  route?: string;
  request?: Partial<CapturedExchange['request']>;
  response?: Partial<CapturedExchange['response']>;
};

function createExchange(overrides: ExchangeOverrides = {}): CapturedExchange {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    route: '/v1/chat/completions',
    ...overrides,
    request: {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {
        'content-type': 'application/json',
      },
      body: {
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: 'Use tools when needed.' },
          { role: 'user', content: 'What is the word of the day?' },
          {
            role: 'tool',
            name: 'mcp__test-server__word_of_the_day',
            content: 'Bumfuzzle',
            tool_call_id: 'call-1',
          },
        ],
        tools: [
          { function: { name: 'read_file' } },
          { function: { name: 'mcp__test-server__word_of_the_day' } },
        ],
      },
      ...overrides.request,
    },
    response: {
      status: 200,
      body: {
        choices: [
          {
            message: {
              content: 'Final answer',
              tool_calls: [
                {
                  function: {
                    name: 'mcp__test-server__word_of_the_day',
                    arguments: '{}',
                  },
                },
              ],
            },
          },
        ],
      },
      ...overrides.response,
    },
  };
}

describe('formatExchangeContext', () => {
  it('includes route, request status line, timestamp, and request/response details', () => {
    const context = formatExchangeContext(createExchange());

    expect(context).toContain('Route: /v1/chat/completions');
    expect(context).toContain('Request: POST /v1/chat/completions -> 200');
    expect(context).toContain('Timestamp: 2026-01-01T00:00:00.000Z');
    expect(context).toContain('Request body:');
    expect(context).toContain('  model: gpt-4.1-mini');
    expect(context).toContain('  messages (3):');
    expect(context).toContain('    - [0] system: "Use tools when needed."');
    expect(context).toContain('    - [2] tool [name: mcp__test-server__word_of_the_day]: "Bumfuzzle"');
    expect(context).toContain(
      '  tools (2): read_file, mcp__test-server__word_of_the_day',
    );
    expect(context).toContain('Response body:');
    expect(context).toContain('  tool_calls (1): mcp__test-server__word_of_the_day');
    expect(context).toContain('  content: "Final answer"');
  });

  it('truncates response content previews at 100 characters with ellipsis', () => {
    const longContent = 'r'.repeat(101);
    const context = formatExchangeContext(
      createExchange({
        response: {
          body: {
            choices: [
              {
                message: {
                  content: longContent,
                },
              },
            ],
          },
        },
      }),
    );

    expect(context).toContain(`content: "${'r'.repeat(100)}..."`);
  });

  it('truncates message content previews at 60 characters with ellipsis', () => {
    const longMessage = 'm'.repeat(61);
    const context = formatExchangeContext(
      createExchange({
        request: {
          body: {
            model: 'gpt-4.1-mini',
            messages: [{ role: 'user', content: longMessage }],
            tools: [],
          },
        },
      }),
    );

    expect(context).toContain(`- [0] user: "${'m'.repeat(60)}..."`);
  });
});

describe('formatExchangeList', () => {
  it('returns no-captured-exchanges placeholder for empty lists', () => {
    expect(formatExchangeList([])).toBe('  (no captured exchanges)');
  });

  it('formats each exchange with method, path, status, model, and tools count', () => {
    const list = formatExchangeList([
      createExchange({
        request: {
          method: 'POST',
          path: '/v1/chat/completions',
          body: {
            model: 'gpt-4.1-mini',
            tools: [{ function: { name: 'read_file' } }, { function: { name: 'list_files' } }],
          },
        },
        response: { status: 200 },
      }),
      createExchange({
        request: {
          method: 'GET',
          path: '/v1/models',
          body: {
            model: 'gpt-4.1',
            tools: [],
          },
        },
        response: { status: 404 },
      }),
    ]);

    expect(list).toBe(
      '[0] POST /v1/chat/completions → 200 (model: gpt-4.1-mini, tools: 2)\n' +
      '[1] GET /v1/models → 404 (model: gpt-4.1, tools: 0)',
    );
  });

  it('returns one line per exchange', () => {
    const list = formatExchangeList([
      createExchange({ request: { method: 'POST', path: '/first' }, response: { status: 201 } }),
      createExchange({ request: { method: 'PUT', path: '/second' }, response: { status: 202 } }),
      createExchange({ request: { method: 'DELETE', path: '/third' }, response: { status: 204 } }),
    ]);

    expect(list.split('\n')).toHaveLength(3);
  });
});
