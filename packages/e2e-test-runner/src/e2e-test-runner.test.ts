import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { CONTAINER_HOME } from './persistent-container.js';
import {
  CapturedRequests as CapturedRequestsPackage,
  runPreflight,
  useContainer,
} from '@poe-code/e2e-test-runner';
import { formatExchangeContext, formatExchangeList } from './matcher-format.js';
import type { ExecResult, Container } from './types.js';
import type { CapturedExchange, ProxyRoute, ProxyConfig, SnapshotMode, SnapshotMissBehavior } from './proxy-types.js';
import './matchers.js';
import { isCliInvocation, parseProxyConfigFromArgs, runProxyCli } from './proxy-cli.js';
import { CapturedRequests } from './proxy-requests.js';
import { shellQuote } from './shell-quote.js';

function makeResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return { exitCode: 0, stdout: '', stderr: '', ...overrides };
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'test-container',
    home: CONTAINER_HOME,
    workspace: `${CONTAINER_HOME}/workspace`,
    destroy: vi.fn(),
    exec: vi.fn(),
    execOrThrow: vi.fn(),
    login: vi.fn(),
    fileExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn(),
    proxyLog: vi.fn().mockResolvedValue(null),
    requests: vi.fn().mockResolvedValue({ length: 0 }),
    writeSnapshots: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeExchange(overrides: {
  timestamp?: string;
  route?: string;
  request?: Partial<CapturedExchange['request']>;
  response?: Partial<CapturedExchange['response']>;
} = {}): CapturedExchange {
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
        model: 'Claude-Haiku-4.5',
        messages: [
          { role: 'system', content: 'Use tools when needed.' },
          { role: 'user', content: 'What is the word of the day?' },
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
        choices: [{ message: { content: 'Final answer' } }],
      },
      ...overrides.response,
    },
  };
}

function createFormatExchange(overrides: {
  timestamp?: string;
  route?: string;
  request?: Partial<CapturedExchange['request']>;
  response?: Partial<CapturedExchange['response']>;
} = {}): CapturedExchange {
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

// =============================================================================
// index.test.ts
// =============================================================================

describe('package root exports', () => {
  function createExchange(overrides: {
    request?: Partial<CapturedExchange['request']>;
    response?: Partial<CapturedExchange['response']>;
  } = {}): CapturedExchange {
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

  it('exports CapturedRequests class and CapturedExchange type', () => {
    const requests = new CapturedRequestsPackage([createExchange()]);

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

// =============================================================================
// matcher-format.test.ts
// =============================================================================

describe('formatExchangeContext', () => {
  it('includes route, request status line, timestamp, and request/response details', () => {
    const context = formatExchangeContext(createFormatExchange());

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
      createFormatExchange({
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
      createFormatExchange({
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
      createFormatExchange({
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
      createFormatExchange({
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
      createFormatExchange({ request: { method: 'POST', path: '/first' }, response: { status: 201 } }),
      createFormatExchange({ request: { method: 'PUT', path: '/second' }, response: { status: 202 } }),
      createFormatExchange({ request: { method: 'DELETE', path: '/third' }, response: { status: 204 } }),
    ]);

    expect(list.split('\n')).toHaveLength(3);
  });
});

// =============================================================================
// matchers.test.ts
// =============================================================================

describe('toHaveExitCode', () => {
  it('passes when exit code matches', () => {
    expect(makeResult({ exitCode: 0 })).toHaveExitCode(0);
  });

  it('passes for non-zero exit code', () => {
    expect(makeResult({ exitCode: 42 })).toHaveExitCode(42);
  });

  it('fails when exit code does not match', () => {
    expect(() => {
      expect(makeResult({ exitCode: 1 })).toHaveExitCode(0);
    }).toThrow('expected exit code 0, got 1');
  });

  it('supports .not modifier', () => {
    expect(makeResult({ exitCode: 1 })).not.toHaveExitCode(0);
  });

  it('failure message includes full context', () => {
    expect(() => {
      expect(makeResult({ exitCode: 1, stdout: 'some output', stderr: 'some error' })).toHaveExitCode(0);
    }).toThrow(/stdout: some output/);
  });

  it('failure message includes command when present', () => {
    expect(() => {
      expect(makeResult({ exitCode: 1, command: 'poe-code install foo' })).toHaveExitCode(0);
    }).toThrow(/Command: poe-code install foo/);
  });
});

describe('toSucceedWith', () => {
  it('passes when exit code is 0 and stdout contains text', () => {
    expect(makeResult({ exitCode: 0, stdout: 'installed successfully' })).toSucceedWith('installed');
  });

  it('fails when exit code is non-zero', () => {
    expect(() => {
      expect(makeResult({ exitCode: 1, stdout: 'installed successfully' })).toSucceedWith('installed');
    }).toThrow('exit code was 1');
  });

  it('fails when stdout does not contain text', () => {
    expect(() => {
      expect(makeResult({ exitCode: 0, stdout: 'done' })).toSucceedWith('installed');
    }).toThrow('stdout does not contain "installed"');
  });

  it('fails with both reasons when both conditions fail', () => {
    expect(() => {
      expect(makeResult({ exitCode: 1, stdout: 'done' })).toSucceedWith('installed');
    }).toThrow(/exit code was 1/);
  });

  it('supports .not modifier', () => {
    expect(makeResult({ exitCode: 1, stdout: '' })).not.toSucceedWith('installed');
  });

  it('failure message includes full context', () => {
    expect(() => {
      expect(makeResult({ exitCode: 1, stdout: 'output', stderr: 'err' })).toSucceedWith('text');
    }).toThrow(/stderr: err/);
  });

  it('failure message includes command when present', () => {
    expect(() => {
      expect(makeResult({ exitCode: 1, stdout: 'output', command: 'poe-code test foo' })).toSucceedWith('text');
    }).toThrow(/Command: poe-code test foo/);
  });
});

describe('toFail', () => {
  it('passes when exit code is non-zero', () => {
    expect(makeResult({ exitCode: 1 })).toFail();
  });

  it('fails when exit code is 0', () => {
    expect(() => {
      expect(makeResult({ exitCode: 0 })).toFail();
    }).toThrow('expected command to fail but it exited with code 0');
  });

  it('supports .not modifier', () => {
    expect(makeResult({ exitCode: 0 })).not.toFail();
  });

  it('failure message includes full context', () => {
    expect(() => {
      expect(makeResult({ exitCode: 0, stdout: 'ok', stderr: '' })).toFail();
    }).toThrow(/stdout: ok/);
  });
});

describe('toFailWith', () => {
  it('passes when exit code is non-zero and stderr contains text', () => {
    expect(makeResult({ exitCode: 1, stderr: 'file not found' })).toFailWith('not found');
  });

  it('fails when exit code is 0', () => {
    expect(() => {
      expect(makeResult({ exitCode: 0, stderr: 'not found' })).toFailWith('not found');
    }).toThrow('command succeeded (exit code 0)');
  });

  it('fails when stderr does not contain text', () => {
    expect(() => {
      expect(makeResult({ exitCode: 1, stderr: 'permission denied' })).toFailWith('not found');
    }).toThrow('stderr does not contain "not found"');
  });

  it('supports .not modifier', () => {
    expect(makeResult({ exitCode: 0, stderr: '' })).not.toFailWith('error');
  });

  it('failure message includes full context', () => {
    expect(() => {
      expect(makeResult({ exitCode: 0, stdout: 'out', stderr: 'err' })).toFailWith('missing');
    }).toThrow(/stdout: out/);
  });
});

describe('toHaveStdout', () => {
  it('passes when stdout contains string', () => {
    expect(makeResult({ stdout: 'hello world' })).toHaveStdout('hello');
  });

  it('passes when stdout matches regex', () => {
    expect(makeResult({ stdout: 'version 1.2.3' })).toHaveStdout(/version \d+\.\d+\.\d+/);
  });

  it('fails when stdout does not contain string', () => {
    expect(() => {
      expect(makeResult({ stdout: 'hello' })).toHaveStdout('goodbye');
    }).toThrow('expected stdout to match goodbye');
  });

  it('fails when stdout does not match regex', () => {
    expect(() => {
      expect(makeResult({ stdout: 'no version here' })).toHaveStdout(/\d+\.\d+\.\d+/);
    }).toThrow(/expected stdout to match/);
  });

  it('supports .not modifier', () => {
    expect(makeResult({ stdout: 'hello' })).not.toHaveStdout('goodbye');
  });

  it('failure message includes full context', () => {
    expect(() => {
      expect(makeResult({ exitCode: 0, stdout: 'actual', stderr: 'errs' })).toHaveStdout('expected');
    }).toThrow(/stderr: errs/);
  });
});

describe('toHaveStderr', () => {
  it('passes when stderr contains string', () => {
    expect(makeResult({ stderr: 'warning: deprecated' })).toHaveStderr('warning');
  });

  it('passes when stderr matches regex', () => {
    expect(makeResult({ stderr: 'Error at line 42' })).toHaveStderr(/Error at line \d+/);
  });

  it('fails when stderr does not contain string', () => {
    expect(() => {
      expect(makeResult({ stderr: 'info' })).toHaveStderr('error');
    }).toThrow('expected stderr to match error');
  });

  it('fails when stderr does not match regex', () => {
    expect(() => {
      expect(makeResult({ stderr: 'no match' })).toHaveStderr(/\d+/);
    }).toThrow(/expected stderr to match/);
  });

  it('supports .not modifier', () => {
    expect(makeResult({ stderr: 'info' })).not.toHaveStderr('error');
  });

  it('failure message includes full context', () => {
    expect(() => {
      expect(makeResult({ exitCode: 1, stdout: 'out', stderr: 'actual' })).toHaveStderr('expected');
    }).toThrow(/stdout: out/);
  });
});

describe('toHaveFile', () => {
  it('passes when file exists', async () => {
    const container = makeContainer({
      fileExists: vi.fn().mockResolvedValue(true),
    });
    await expect(container).toHaveFile('/root/.config/settings.json');
  });

  it('fails when file does not exist', async () => {
    const container = makeContainer({
      fileExists: vi.fn().mockResolvedValue(false),
    });
    await expect(
      expect(container).toHaveFile('/root/.config/missing.json')
    ).rejects.toThrow('expected container to have file "/root/.config/missing.json"');
  });

  it('supports .not modifier', async () => {
    const container = makeContainer({
      fileExists: vi.fn().mockResolvedValue(false),
    });
    await expect(container).not.toHaveFile('/no/such/file');
  });

  it('calls fileExists with the correct path', async () => {
    const fileExists = vi.fn().mockResolvedValue(true);
    const container = makeContainer({ fileExists });
    await expect(container).toHaveFile('/specific/path');
    expect(fileExists).toHaveBeenCalledWith('/specific/path');
  });
});

describe('toHaveFileContaining', () => {
  it('passes when file exists and contains text', async () => {
    const container = makeContainer({
      fileExists: vi.fn().mockResolvedValue(true),
      readFile: vi.fn().mockResolvedValue('{"key": "value"}'),
    });
    await expect(container).toHaveFileContaining('/config.json', '"key"');
  });

  it('fails when file does not exist', async () => {
    const container = makeContainer({
      fileExists: vi.fn().mockResolvedValue(false),
    });
    await expect(
      expect(container).toHaveFileContaining('/missing.json', 'text')
    ).rejects.toThrow('file does not exist');
  });

  it('fails when file exists but does not contain text', async () => {
    const container = makeContainer({
      fileExists: vi.fn().mockResolvedValue(true),
      readFile: vi.fn().mockResolvedValue('other content'),
    });
    await expect(
      expect(container).toHaveFileContaining('/config.json', 'missing text')
    ).rejects.toThrow('expected file "/config.json" to contain "missing text"');
  });

  it('failure message includes file content', async () => {
    const container = makeContainer({
      fileExists: vi.fn().mockResolvedValue(true),
      readFile: vi.fn().mockResolvedValue('actual file content'),
    });
    await expect(
      expect(container).toHaveFileContaining('/config.json', 'missing')
    ).rejects.toThrow(/Content: actual file content/);
  });

  it('supports .not modifier', async () => {
    const container = makeContainer({
      fileExists: vi.fn().mockResolvedValue(true),
      readFile: vi.fn().mockResolvedValue('some content'),
    });
    await expect(container).not.toHaveFileContaining('/config.json', 'missing');
  });

  it('calls fileExists and readFile with the correct path', async () => {
    const fileExists = vi.fn().mockResolvedValue(true);
    const readFile = vi.fn().mockResolvedValue('content');
    const container = makeContainer({ fileExists, readFile });
    await expect(container).toHaveFileContaining('/specific/path', 'content');
    expect(fileExists).toHaveBeenCalledWith('/specific/path');
    expect(readFile).toHaveBeenCalledWith('/specific/path');
  });
});

describe('toHaveRequestBody', () => {
  it('passes when request body matches expected partial deeply', () => {
    const exchange = makeExchange();

    expect(exchange).toHaveRequestBody({
      model: 'Claude-Haiku-4.5',
      messages: [{ role: 'system' }],
    });
  });

  it('fails with diff output and full exchange context', () => {
    const exchange = makeExchange();
    let error: unknown;

    try {
      expect(exchange).toHaveRequestBody({ model: 'Claude-Sonnet-4.5' });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('expected request body to match');
    expect(message).toContain('Diff:');
    expect(message).toContain('- Expected');
    expect(message).toContain('+ Received');
    expect(message).toContain('Full exchange:');
    expect(message).toContain('Route: /v1/chat/completions');
    expect(message).toContain('Request: POST /v1/chat/completions -> 200');
  });

  it('uses negated message format when .not assertion fails', () => {
    const exchange = makeExchange();

    expect(() => {
      expect(exchange).not.toHaveRequestBody({ model: 'Claude-Haiku-4.5' });
    }).toThrow('expected request body not to match');
  });
});

describe('toHaveResponseBody', () => {
  it('passes when response body matches expected partial deeply', () => {
    const exchange = makeExchange({
      response: {
        body: {
          choices: [
            {
              message: {
                content: 'Final answer',
                tool_calls: [{ function: { name: 'mcp__test-server__word_of_the_day' } }],
              },
            },
          ],
        },
      },
    });

    expect(exchange).toHaveResponseBody({
      choices: [
        {
          message: {
            tool_calls: [{ function: { name: 'mcp__test-server__word_of_the_day' } }],
          },
        },
      ],
    });
  });

  it('fails with diff output and full exchange context', () => {
    const exchange = makeExchange();
    let error: unknown;

    try {
      expect(exchange).toHaveResponseBody({
        choices: [{ message: { content: 'Unexpected content' } }],
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('expected response body to match');
    expect(message).toContain('Diff:');
    expect(message).toContain('- Expected');
    expect(message).toContain('+ Received');
    expect(message).toContain('Full exchange:');
    expect(message).toContain('Route: /v1/chat/completions');
    expect(message).toContain('Request: POST /v1/chat/completions -> 200');
  });

  it('uses negated message format when .not assertion fails', () => {
    const exchange = makeExchange();

    expect(() => {
      expect(exchange).not.toHaveResponseBody({
        choices: [{ message: { content: 'Final answer' } }],
      });
    }).toThrow('expected response body not to match');
  });
});

describe('toContainRequest', () => {
  it('passes when at least one exchange matches all criteria', () => {
    const exchanges = [
      makeExchange({
        request: {
          method: 'GET',
          path: '/v1/models',
          body: { model: 'gpt-4.1-mini', tools: [] },
        },
      }),
      makeExchange(),
    ];

    expect(exchanges).toContainRequest({
      path: '/v1/chat/completions',
      method: 'POST',
      bodyContaining: {
        model: 'Claude-Haiku-4.5',
        messages: [{ role: 'system' }],
      },
    });
  });

  it('supports optional path, method, and bodyContaining criteria', () => {
    const exchanges = [
      makeExchange({
        request: {
          method: 'GET',
          path: '/v1/models',
          body: { model: 'gpt-4.1-mini', tools: [] },
        },
      }),
      makeExchange(),
    ];

    expect(exchanges).toContainRequest({ path: '/v1/models' });
    expect(exchanges).toContainRequest({ method: 'POST' });
    expect(exchanges).toContainRequest({
      bodyContaining: {
        tools: [{ function: { name: 'read_file' } }],
      },
    });
  });

  it('fails with criteria summary and all captured exchanges', () => {
    const exchanges = [
      makeExchange(),
      makeExchange({
        request: {
          method: 'GET',
          path: '/v1/models',
          body: {
            model: 'gpt-4.1-mini',
            tools: [],
          },
        },
        response: { status: 404 },
      }),
    ];
    let error: unknown;

    try {
      expect(exchanges).toContainRequest({
        path: '/v1/embeddings',
        method: 'PUT',
        bodyContaining: { model: 'Claude-Sonnet-4.5' },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain(
      'expected at least one exchange matching {path: "/v1/embeddings", method: "PUT", body containing: {"model":"Claude-Sonnet-4.5"}}, but none found',
    );
    expect(message).toContain('All captured exchanges (2):');
    expect(message).toContain(
      '[0] POST /v1/chat/completions → 200 (model: Claude-Haiku-4.5, tools: 2)',
    );
    expect(message).toContain('[1] GET /v1/models → 404 (model: gpt-4.1-mini, tools: 0)');
  });

  it('uses negated message format when .not assertion fails', () => {
    const exchanges = [makeExchange()];

    expect(() => {
      expect(exchanges).not.toContainRequest({
        path: '/v1/chat/completions',
        method: 'POST',
      });
    }).toThrow(
      'expected no exchange matching {path: "/v1/chat/completions", method: "POST"}',
    );
  });
});

describe('toHaveToolInRequest', () => {
  it('passes when tool name found in tools array', () => {
    const exchange = makeExchange();

    expect(exchange).toHaveToolInRequest('mcp__test-server__word_of_the_day');
  });

  it('fails showing expected tool name, actual tools list, and exchange context', () => {
    const exchange = makeExchange();
    let error: unknown;

    try {
      expect(exchange).toHaveToolInRequest('mcp__test-server__caesar_cipher_encrypt');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain(
      'expected request to contain tool "mcp__test-server__caesar_cipher_encrypt"\n  Tools present: [read_file, mcp__test-server__word_of_the_day]\n  Route: /v1/chat/completions',
    );
    expect(message).toContain('Request: POST /v1/chat/completions -> 200');
  });
});

describe('toHaveToolCall', () => {
  it('passes when tool_call name found in response', () => {
    const exchange = makeExchange({
      response: {
        body: {
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { function: { name: 'read_file', arguments: '{"path":"README.md"}' } },
                  { function: { name: 'mcp__test-server__word_of_the_day', arguments: '{}' } },
                ],
              },
            },
          ],
        },
      },
    });

    expect(exchange).toHaveToolCall('mcp__test-server__word_of_the_day');
  });

  it('fails showing expected name, actual tool_call names, and exchange context', () => {
    const exchange = makeExchange({
      response: {
        body: {
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { function: { name: 'read_file', arguments: '{"path":"README.md"}' } },
                  { function: { name: 'mcp__test-server__word_of_the_day', arguments: '{}' } },
                ],
              },
            },
          ],
        },
      },
    });
    let error: unknown;

    try {
      expect(exchange).toHaveToolCall('mcp__test-server__caesar_cipher_encrypt');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain(
      'expected response to have tool_call "mcp__test-server__caesar_cipher_encrypt"\n  tool_calls present: [read_file, mcp__test-server__word_of_the_day]\n  Route: /v1/chat/completions',
    );
    expect(message).toContain('Request: POST /v1/chat/completions -> 200');
  });
});

describe('toHaveToolResult', () => {
  it('passes when tool message found with matching name', () => {
    const exchange = makeExchange({
      request: {
        body: {
          model: 'Claude-Haiku-4.5',
          messages: [
            { role: 'user', content: 'What is the word of the day?' },
            {
              role: 'tool',
              name: 'mcp__test-server__word_of_the_day',
              tool_call_id: 'call-1',
              content: 'Bumfuzzle',
            },
          ],
        },
      },
    });

    expect(exchange).toHaveToolResult('mcp__test-server__word_of_the_day');
  });

  it('supports optional string content matcher (includes check)', () => {
    const exchange = makeExchange({
      request: {
        body: {
          messages: [
            { role: 'user', content: 'What is the word of the day?' },
            {
              role: 'tool',
              name: 'mcp__test-server__word_of_the_day',
              tool_call_id: 'call-1',
              content: 'Bumfuzzle means to confuse someone in a flustered way.',
            },
          ],
        },
      },
    });

    expect(exchange).toHaveToolResult('mcp__test-server__word_of_the_day', 'Bumfuzzle means');
  });

  it('supports optional RegExp content matcher', () => {
    const exchange = makeExchange({
      request: {
        body: {
          messages: [
            { role: 'user', content: 'What is the word of the day?' },
            {
              role: 'tool',
              name: 'mcp__test-server__word_of_the_day',
              tool_call_id: 'call-1',
              content: 'Bumfuzzle means to confuse someone in a flustered way.',
            },
          ],
        },
      },
    });

    expect(exchange).toHaveToolResult('mcp__test-server__word_of_the_day', /bumfuzzle/i);
  });

  it('fails when tool name is missing and shows tool messages with exchange context', () => {
    const exchange = makeExchange({
      request: {
        body: {
          messages: [
            { role: 'user', content: 'Read the file' },
            { role: 'tool', name: 'read_file', tool_call_id: 'call-1', content: 'Hello from the file!' },
          ],
        },
      },
    });
    let error: unknown;

    try {
      expect(exchange).toHaveToolResult('mcp__test-server__word_of_the_day');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain(
      'expected request to have tool result for "mcp__test-server__word_of_the_day", but no tool message with that name found',
    );
    expect(message).toContain('Tool messages in request:\n  - read_file: "Hello from the file!"');
    expect(message).toContain('Full exchange:');
    expect(message).toContain('Route: /v1/chat/completions');
  });

  it('fails when content matcher does not match and shows actual content with exchange context', () => {
    const exchange = makeExchange({
      request: {
        body: {
          messages: [
            { role: 'user', content: 'What is the word of the day?' },
            {
              role: 'tool',
              name: 'mcp__test-server__word_of_the_day',
              tool_call_id: 'call-1',
              content: 'actual content',
            },
          ],
        },
      },
    });
    let error: unknown;

    try {
      expect(exchange).toHaveToolResult('mcp__test-server__word_of_the_day', 'Bumfuzzle');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain(
      'expected tool result for "mcp__test-server__word_of_the_day" to match Bumfuzzle',
    );
    expect(message).toContain('Actual content: "actual content"');
    expect(message).toContain('Full exchange:');
    expect(message).toContain('Route: /v1/chat/completions');
  });

  it('truncates tool message content preview at 80 chars in missing-tool failures', () => {
    const longContent = 'a'.repeat(81);
    const exchange = makeExchange({
      request: {
        body: {
          messages: [
            { role: 'user', content: 'Read the file' },
            { role: 'tool', name: 'read_file', tool_call_id: 'call-1', content: longContent },
          ],
        },
      },
    });
    let error: unknown;

    try {
      expect(exchange).toHaveToolResult('mcp__test-server__word_of_the_day');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain(`  - read_file: "${longContent.slice(0, 80)}..."`);
    expect(message).not.toContain(`  - read_file: "${longContent}"`);
  });
});

describe('toHaveHealthyProxy', () => {
  it('passes when proxy log contains listening message and no errors', async () => {
    const container = makeContainer({
      proxyLog: vi.fn().mockResolvedValue('Proxy server listening on http://127.0.0.1:3456\nForwarding /v1/chat/completions'),
    });
    await expect(container).toHaveHealthyProxy();
  });

  it('passes when proxy is not enabled (null log)', async () => {
    const container = makeContainer({
      proxyLog: vi.fn().mockResolvedValue(null),
    });
    await expect(container).toHaveHealthyProxy();
  });

  it('fails when proxy log contains Error:', async () => {
    const container = makeContainer({
      proxyLog: vi.fn().mockResolvedValue('Proxy server listening on http://127.0.0.1:3456\nError: connection refused'),
    });
    await expect(
      expect(container).toHaveHealthyProxy()
    ).rejects.toThrow('proxy log contains errors');
  });

  it('fails when proxy log is missing listening message', async () => {
    const container = makeContainer({
      proxyLog: vi.fn().mockResolvedValue('some other output'),
    });
    await expect(
      expect(container).toHaveHealthyProxy()
    ).rejects.toThrow('proxy log missing listening confirmation');
  });

  it('failure message includes proxy log content', async () => {
    const container = makeContainer({
      proxyLog: vi.fn().mockResolvedValue('Error: something went wrong'),
    });
    await expect(
      expect(container).toHaveHealthyProxy()
    ).rejects.toThrow(/Error: something went wrong/);
  });

  it('supports .not modifier', async () => {
    const container = makeContainer({
      proxyLog: vi.fn().mockResolvedValue('Error: something went wrong'),
    });
    await expect(container).not.toHaveHealthyProxy();
  });
});

// =============================================================================
// proxy-cli.test.ts
// =============================================================================

describe('parseProxyConfigFromArgs', () => {
  it('parses inline flags with default onMiss', async () => {
    const config = await parseProxyConfigFromArgs([
      '--port',
      '3456',
      '--capture',
      '/tmp/proxy-capture.jsonl',
      '--route',
      '/v1/chat/completions=playback:/tmp/proxy-snapshots',
    ]);

    expect(config).toEqual<ProxyConfig>({
      port: 3456,
      captureFile: '/tmp/proxy-capture.jsonl',
      onMiss: 'error',
      routes: [
        {
          path: '/v1/chat/completions',
          mode: 'playback',
          snapshotDir: '/tmp/proxy-snapshots',
          target: 'https://api.poe.com',
        },
      ],
    });
  });

  it('parses --miss flag', async () => {
    const config = await parseProxyConfigFromArgs([
      '--port',
      '3456',
      '--capture',
      '/tmp/proxy-capture.jsonl',
      '--route',
      '/v1/chat/completions=playback:/tmp/proxy-snapshots',
      '--miss',
      'record',
    ]);

    expect(config.onMiss).toBe('record');
  });

  it('throws on invalid --miss value', async () => {
    await expect(
      parseProxyConfigFromArgs([
        '--port',
        '3456',
        '--capture',
        '/tmp/proxy-capture.jsonl',
        '--route',
        '/v1/chat/completions=playback:/tmp/proxy-snapshots',
        '--miss',
        'invalid',
      ]),
    ).rejects.toThrow('Invalid --miss value: invalid');
  });

  it('rejects non-decimal --port values', async () => {
    for (const port of ['0x50', '1e3', '080']) {
      await expect(
        parseProxyConfigFromArgs([
          '--port',
          port,
          '--capture',
          '/tmp/proxy-capture.jsonl',
          '--route',
          '/v1/chat/completions=playback:/tmp/proxy-snapshots',
        ]),
      ).rejects.toThrow('--port must be a decimal integer between 1 and 65535.');
    }
  });

  it('loads JSON config with --config path', async () => {
    const configFromFile: ProxyConfig = {
      port: 4000,
      captureFile: '/tmp/capture.jsonl',
      onMiss: 'passthrough',
      routes: [
        {
          path: '/v1',
          target: 'https://api.poe.com',
          mode: 'playback',
        },
      ],
    };

    const readFile = vi.fn().mockResolvedValue(JSON.stringify(configFromFile));

    const config = await parseProxyConfigFromArgs(['--config', '/tmp/proxy-config.json'], {
      readFile,
    });

    expect(readFile).toHaveBeenCalledWith('/tmp/proxy-config.json', 'utf8');
    expect(config).toEqual(configFromFile);
  });

  it('defaults onMiss to error in JSON config', async () => {
    const configFromFile = {
      port: 4000,
      captureFile: '/tmp/capture.jsonl',
      routes: [
        {
          path: '/v1',
          target: 'https://api.poe.com',
          mode: 'playback',
        },
      ],
    };

    const readFile = vi.fn().mockResolvedValue(JSON.stringify(configFromFile));

    const config = await parseProxyConfigFromArgs(['--config', '/tmp/proxy-config.json'], {
      readFile,
    });

    expect(config.onMiss).toBe('error');
  });

  it('throws when JSON config onMiss is unsupported', async () => {
    const readFile = vi.fn().mockResolvedValue(JSON.stringify({
      port: 4000,
      captureFile: '/tmp/capture.jsonl',
      onMiss: 'passthru',
      routes: [
        {
          path: '/v1',
          target: 'https://api.poe.com',
          mode: 'playback',
        },
      ],
    }));

    await expect(
      parseProxyConfigFromArgs(['--config', '/tmp/proxy-config.json'], { readFile }),
    ).rejects.toThrow(
      'Invalid proxy config: onMiss must be one of error, warn, passthrough, or record.',
    );
  });

  it('throws when --route has invalid format', async () => {
    await expect(
      parseProxyConfigFromArgs([
        '--port',
        '3456',
        '--capture',
        '/tmp/proxy-capture.jsonl',
        '--route',
        '/v1/chat/completions=playback',
      ]),
    ).rejects.toThrow(
      "Invalid --route format. Expected '/path=mode:/snapshotDir'.",
    );
  });

  it('rejects passthrough as route mode', async () => {
    await expect(
      parseProxyConfigFromArgs([
        '--port',
        '3456',
        '--capture',
        '/tmp/proxy-capture.jsonl',
        '--route',
        '/v1/chat/completions=passthrough:/tmp/proxy-snapshots',
      ]),
    ).rejects.toThrow('Invalid route mode: passthrough');
  });
});

describe('runProxyCli', () => {
  it('returns success for --help', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      const exitCode = await runProxyCli(['--help']);
      expect(exitCode).toBe(0);
      expect(stdout).toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
    }
  });

  it('starts proxy server with parsed config from flags', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const startProxyServer = vi.fn().mockResolvedValue({
      url: 'http://127.0.0.1:3456',
      close,
    });
    const stdout = { write: vi.fn() };
    const waitForShutdown = vi.fn(async (shutdown: () => Promise<void>) => {
      await shutdown();
    });

    const exitCode = await runProxyCli(
      [
        '--port',
        '3456',
        '--capture',
        '/tmp/proxy-capture.jsonl',
        '--route',
        '/v1/chat/completions=playback:/tmp/proxy-snapshots',
      ],
      { startProxyServer, stdout, waitForShutdown },
    );

    expect(exitCode).toBe(0);
    expect(waitForShutdown).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(startProxyServer).toHaveBeenCalledWith({
      port: 3456,
      captureFile: '/tmp/proxy-capture.jsonl',
      onMiss: 'error',
      routes: [
        {
          path: '/v1/chat/completions',
          mode: 'playback',
          snapshotDir: '/tmp/proxy-snapshots',
          target: 'https://api.poe.com',
        },
      ],
    });
    expect(stdout.write).toHaveBeenCalledWith(
      'Proxy server listening on http://127.0.0.1:3456\n',
    );
  });
});

describe('isCliInvocation', () => {
  it('matches direct module invocation', () => {
    expect(
      isCliInvocation(
        ['/usr/bin/node', '/workspace/dist/proxy-cli.js'],
        'file:///workspace/dist/proxy-cli.js',
      ),
    ).toBe(true);
  });

  it('matches symlinked binary invocation by resolving realpath', () => {
    expect(
      isCliInvocation(
        ['/usr/bin/node', '/usr/local/bin/proxy-server'],
        'file:///usr/local/lib/node_modules/@poe-code/e2e-test-runner/dist/proxy-cli.js',
        () => '/usr/local/lib/node_modules/@poe-code/e2e-test-runner/dist/proxy-cli.js',
      ),
    ).toBe(true);
  });
});

// =============================================================================
// proxy-requests.test.ts
// =============================================================================

describe('CapturedRequests', () => {
  function createExchange(overrides: {
    timestamp?: string;
    route?: string;
    request?: Partial<CapturedExchange['request']>;
    response?: Partial<CapturedExchange['response']>;
  } = {}): CapturedExchange {
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

  it('rejects malformed request tool collections via toolNamesAt()', () => {
    const requests = new CapturedRequests([
      createExchange({ request: { body: { tools: 'not-an-array' } } }),
    ]);

    expect(() => requests.toolNamesAt(0)).toThrow('Captured request tools must be an array');
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

  it('rejects primitive decoded tool call arguments via toolCallsAt()', () => {
    const requests = new CapturedRequests([
      createExchange({
        response: {
          body: {
            choices: [{ message: { tool_calls: [{ function: { name: 'read_file', arguments: '7' } }] } }],
          },
        },
      }),
    ]);

    expect(() => requests.toolCallsAt(0)).toThrow('Tool call arguments must decode to an object');
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

// =============================================================================
// proxy-types.test.ts
// =============================================================================

describe('proxy types', () => {
  it('defines SnapshotMode as playback or record', () => {
    expectTypeOf<SnapshotMode>().toEqualTypeOf<'playback' | 'record'>();
  });

  it('defines SnapshotMissBehavior options', () => {
    expectTypeOf<SnapshotMissBehavior>().toEqualTypeOf<'error' | 'warn' | 'passthrough' | 'record'>();
  });

  it('defines ProxyRoute with required fields and optional snapshotDir', () => {
    expectTypeOf<ProxyRoute>().toEqualTypeOf<{
      path: string;
      target: string;
      mode: SnapshotMode;
      snapshotDir?: string;
    }>();
  });

  it('defines ProxyConfig with port, routes, captureFile, and onMiss', () => {
    expectTypeOf<ProxyConfig>().toEqualTypeOf<{
      port: number;
      routes: ProxyRoute[];
      captureFile: string;
      onMiss: SnapshotMissBehavior;
    }>();
  });

  it('defines CapturedExchange request and response payload shape', () => {
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
});

// =============================================================================
// shell-quote.test.ts
// =============================================================================

describe('shellQuote', () => {
  it('wraps value in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'");
  });

  it('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\"'\"'s'");
  });

  it('handles empty string', () => {
    expect(shellQuote('')).toBe("''");
  });

  it('preserves JSON content', () => {
    const json = JSON.stringify({ command: 'node', args: ['--eval', 'console.log("hi")'] });
    const quoted = shellQuote(json);
    expect(quoted[0]).toBe("'");
    expect(quoted[quoted.length - 1]).toBe("'");
    expect(quoted).toContain('"command"');
  });
});
