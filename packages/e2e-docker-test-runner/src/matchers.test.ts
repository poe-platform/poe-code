import { describe, it, expect, vi } from 'vitest';
import type { ExecResult, Container } from './types.js';
import type { CapturedExchange } from './proxy-types.js';
import './matchers.js';

function makeResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return { exitCode: 0, stdout: '', stderr: '', ...overrides };
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'test-container',
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

type ExchangeOverrides = {
  timestamp?: string;
  route?: string;
  request?: Partial<CapturedExchange['request']>;
  response?: Partial<CapturedExchange['response']>;
};

function makeExchange(overrides: ExchangeOverrides = {}): CapturedExchange {
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
