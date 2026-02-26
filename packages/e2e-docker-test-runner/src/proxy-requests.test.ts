import { describe, expect, it } from 'vitest';
import { CapturedRequests } from './proxy-requests.js';
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
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [],
      },
      ...overrides.request,
    },
    response: {
      status: 200,
      body: {
        choices: [{ message: { content: 'response' } }],
      },
      ...overrides.response,
    },
  };
}

describe('CapturedRequests', () => {
  it('returns exchange count via length', () => {
    const requests = new CapturedRequests([createExchange(), createExchange()]);

    expect(requests.length).toBe(2);
  });

  it('returns exchange at index with at(index)', () => {
    const first = createExchange({ request: { method: 'GET', path: '/v1/models' } });
    const second = createExchange({ request: { method: 'POST', path: '/v1/chat/completions' } });
    const requests = new CapturedRequests([first, second]);

    expect(requests.at(0)).toBe(first);
    expect(requests.at(1)).toBe(second);
  });

  it('throws out-of-bounds error with summary content', () => {
    const requests = new CapturedRequests([
      createExchange({
        request: { method: 'POST', path: '/v1/chat/completions', body: { model: 'gpt-4.1' } },
      }),
    ]);

    expect(() => requests.at(2)).toThrowError(
      'No captured request at index 2. Only 1 request(s) captured:\n' +
      '  [0] POST /v1/chat/completions (200)\n' +
      '      model: gpt-4.1\n' +
      '      messages: 0 messages\n' +
      '      tools: 0 tool definitions',
    );
  });

  it('returns a shallow copy from all()', () => {
    const first = createExchange();
    const second = createExchange();
    const requests = new CapturedRequests([first, second]);

    const all = requests.all();
    all.pop();

    expect(all).toHaveLength(1);
    expect(requests.length).toBe(2);
  });

  it('filters by path prefix with forRoute()', () => {
    const requests = new CapturedRequests([
      createExchange({ request: { path: '/v1/chat/completions' } }),
      createExchange({ request: { path: '/v1/chat/completions/stream' } }),
      createExchange({ request: { path: '/v1/models' } }),
    ]);

    const filtered = requests.forRoute('/v1/chat');

    expect(filtered.length).toBe(2);
    expect(filtered.at(0).request.path).toBe('/v1/chat/completions');
    expect(filtered.at(1).request.path).toBe('/v1/chat/completions/stream');
  });

  it('returns a new CapturedRequests instance for forRoute()', () => {
    const requests = new CapturedRequests([createExchange()]);

    const filtered = requests.forRoute('/v1/chat');

    expect(filtered).not.toBe(requests);
    expect(filtered).toBeInstanceOf(CapturedRequests);
  });

  it('filters to response tool calls with withToolCalls()', () => {
    const withCalls = createExchange({
      response: {
        status: 200,
        body: {
          choices: [{
            message: {
              tool_calls: [{ function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }],
            },
          }],
        },
      },
    });
    const withoutCalls = createExchange({
      response: {
        status: 200,
        body: {
          choices: [{ message: { content: 'done' } }],
        },
      },
    });
    const requests = new CapturedRequests([withCalls, withoutCalls]);

    const filtered = requests.withToolCalls();

    expect(filtered.length).toBe(1);
    expect(filtered.at(0)).toBe(withCalls);
  });

  it('filters to request tool messages with withToolResults()', () => {
    const withResults = createExchange({
      request: {
        body: {
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'tool', name: 'read_file', content: 'file content', tool_call_id: 'call-1' },
          ],
        },
      },
    });
    const withoutResults = createExchange({
      request: {
        body: {
          messages: [{ role: 'assistant', content: 'no tool' }],
        },
      },
    });
    const requests = new CapturedRequests([withResults, withoutResults]);

    const filtered = requests.withToolResults();

    expect(filtered.length).toBe(1);
    expect(filtered.at(0)).toBe(withResults);
  });

  it('extracts request tool names via toolNamesAt()', () => {
    const requests = new CapturedRequests([
      createExchange({
        request: {
          body: {
            tools: [
              { function: { name: 'read_file' } },
              { function: { name: 'mcp__test-server__word_of_the_day' } },
            ],
          },
        },
      }),
    ]);

    expect(requests.toolNamesAt(0)).toEqual(['read_file', 'mcp__test-server__word_of_the_day']);
  });

  it('extracts response tool calls via toolCallsAt()', () => {
    const requests = new CapturedRequests([
      createExchange({
        response: {
          status: 200,
          body: {
            choices: [{
              message: {
                tool_calls: [
                  {
                    function: {
                      name: 'read_file',
                      arguments: '{"path":"README.md"}',
                    },
                  },
                  {
                    function: {
                      name: 'list_files',
                      arguments: '{"path":"src"}',
                    },
                  },
                ],
              },
            }],
          },
        },
      }),
    ]);

    expect(requests.toolCallsAt(0)).toEqual([
      { name: 'read_file', arguments: { path: 'README.md' } },
      { name: 'list_files', arguments: { path: 'src' } },
    ]);
  });

  it('extracts request messages via messagesAt()', () => {
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'tool', name: 'read_file', tool_call_id: 'call-1', content: 'done' },
    ];
    const requests = new CapturedRequests([
      createExchange({
        request: {
          body: {
            messages,
          },
        },
      }),
    ]);

    expect(requests.messagesAt(0)).toEqual(messages);
  });

  it('extracts tool result by tool name via toolResultAt()', () => {
    const requests = new CapturedRequests([
      createExchange({
        request: {
          body: {
            messages: [
              { role: 'user', content: 'start' },
              { role: 'tool', name: 'read_file', tool_call_id: 'call-1', content: 'content from file' },
            ],
          },
        },
      }),
    ]);

    expect(requests.toolResultAt(0, 'read_file')).toEqual({
      content: 'content from file',
      tool_call_id: 'call-1',
    });
    expect(requests.toolResultAt(0, 'missing_tool')).toBeUndefined();
  });

  it('returns human-readable multiline summary', () => {
    const requests = new CapturedRequests([
      createExchange({
        request: {
          method: 'POST',
          path: '/v1/chat/completions',
          body: {
            model: 'gpt-4.1-mini',
            messages: [{ role: 'user', content: 'hey' }],
            tools: [{ function: { name: 'read_file' } }],
          },
        },
        response: {
          status: 200,
          body: {
            choices: [{
              message: {
                content: 'done',
                tool_calls: [{ function: { name: 'read_file' } }],
              },
            }],
          },
        },
      }),
      createExchange({
        request: {
          method: 'GET',
          path: '/v1/models',
          body: {},
        },
        response: {
          status: 404,
          body: {
            choices: [{ message: { content: 'not found' } }],
          },
        },
      }),
    ]);

    expect(requests.summary()).toBe(
      '  [0] POST /v1/chat/completions (200)\n' +
      '      model: gpt-4.1-mini\n' +
      '      messages: 1 messages\n' +
      '      tools: 1 tool definitions\n' +
      '      response tool_calls: [read_file]\n' +
      '      response content: "done"\n' +
      '  [1] GET /v1/models (404)\n' +
      '      model: (none)\n' +
      '      messages: 0 messages\n' +
      '      tools: 0 tool definitions\n' +
      '      response content: "not found"',
    );
  });

  it('returns no-captured-requests summary when empty', () => {
    const requests = new CapturedRequests([]);

    expect(requests.summary()).toBe('  (no captured requests)');
  });

  it('returns pretty JSON from debugAt()', () => {
    const exchange = createExchange({
      response: { status: 201, body: { ok: true } },
    });
    const requests = new CapturedRequests([exchange]);

    expect(requests.debugAt(0)).toBe(JSON.stringify(exchange, null, 2));
  });
});
