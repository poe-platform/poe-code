import { expect } from 'bun:test';
import type { ExecResult, Container } from './types.js';
import type { CapturedExchange } from './proxy-types.js';
import { formatExchangeContext, formatExchangeList } from './matcher-format.js';

function formatExecContext(result: ExecResult): string {
  const lines: string[] = [];
  if (result.command) {
    lines.push(`  Command: ${result.command}`);
  }
  lines.push(
    `  Exit code: ${result.exitCode}`,
    `  stdout: ${result.stdout || '(empty)'}`,
    `  stderr: ${result.stderr || '(empty)'}`,
  );
  return lines.join('\n');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesDeepPartial(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return false;
    }
    return expected.every((expectedItem, index) =>
      matchesDeepPartial(actual[index], expectedItem),
    );
  }

  if (isObject(expected)) {
    if (!isObject(actual)) {
      return false;
    }
    return Object.entries(expected).every(([key, expectedValue]) =>
      matchesDeepPartial(actual[key], expectedValue),
    );
  }

  return Object.is(actual, expected);
}

type RequestMatcher = {
  path?: string;
  method?: string;
  bodyContaining?: Record<string, unknown>;
};

type RequestMessage = {
  role?: string;
  content?: unknown;
  name?: string;
};

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function messageContentToString(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (content === undefined) {
    return '';
  }
  try {
    return JSON.stringify(content) ?? String(content);
  } catch {
    return String(content);
  }
}

function matchesContent(content: string, matcher: string | RegExp): boolean {
  if (typeof matcher === 'string') {
    return content.includes(matcher);
  }
  return new RegExp(matcher.source, matcher.flags).test(content);
}

const customMatchers = {
  toHaveExitCode(received: ExecResult, expected: number) {
    const pass = received.exitCode === expected;
    return {
      pass,
      message: () =>
        pass
          ? `expected exit code not to be ${expected}\n${formatExecContext(received)}`
          : `expected exit code ${expected}, got ${received.exitCode}\n${formatExecContext(received)}`,
    };
  },

  toSucceedWith(received: ExecResult, text: string) {
    const exitCodeOk = received.exitCode === 0;
    const stdoutMatch = received.stdout.includes(text);
    const pass = exitCodeOk && stdoutMatch;
    return {
      pass,
      message: () => {
        if (pass) {
          return `expected command not to succeed with "${text}"\n${formatExecContext(received)}`;
        }
        const reasons: string[] = [];
        if (!exitCodeOk) reasons.push(`exit code was ${received.exitCode} (expected 0)`);
        if (!stdoutMatch) reasons.push(`stdout does not contain "${text}"`);
        return `expected command to succeed with "${text}"\n  ${reasons.join(', ')}\n${formatExecContext(received)}`;
      },
    };
  },

  toFail(received: ExecResult) {
    const pass = received.exitCode !== 0;
    return {
      pass,
      message: () =>
        pass
          ? `expected command not to fail\n${formatExecContext(received)}`
          : `expected command to fail but it exited with code 0\n${formatExecContext(received)}`,
    };
  },

  toFailWith(received: ExecResult, text: string) {
    const exitCodeFail = received.exitCode !== 0;
    const stderrMatch = received.stderr.includes(text);
    const pass = exitCodeFail && stderrMatch;
    return {
      pass,
      message: () => {
        if (pass) {
          return `expected command not to fail with "${text}"\n${formatExecContext(received)}`;
        }
        const reasons: string[] = [];
        if (!exitCodeFail) reasons.push('command succeeded (exit code 0)');
        if (!stderrMatch) reasons.push(`stderr does not contain "${text}"`);
        return `expected command to fail with "${text}"\n  ${reasons.join(', ')}\n${formatExecContext(received)}`;
      },
    };
  },

  toHaveStdout(received: ExecResult, matcher: string | RegExp) {
    const pass =
      typeof matcher === 'string'
        ? received.stdout.includes(matcher)
        : matcher.test(received.stdout);
    return {
      pass,
      message: () =>
        pass
          ? `expected stdout not to match ${matcher}\n${formatExecContext(received)}`
          : `expected stdout to match ${matcher}\n${formatExecContext(received)}`,
    };
  },

  toHaveStderr(received: ExecResult, matcher: string | RegExp) {
    const pass =
      typeof matcher === 'string'
        ? received.stderr.includes(matcher)
        : matcher.test(received.stderr);
    return {
      pass,
      message: () =>
        pass
          ? `expected stderr not to match ${matcher}\n${formatExecContext(received)}`
          : `expected stderr to match ${matcher}\n${formatExecContext(received)}`,
    };
  },

  async toHaveFile(received: Container, filePath: string) {
    const exists = await received.fileExists(filePath);
    return {
      pass: exists,
      message: () =>
        exists
          ? `expected container not to have file "${filePath}"`
          : `expected container to have file "${filePath}"`,
    };
  },

  async toHaveFileContaining(received: Container, filePath: string, text: string) {
    const exists = await received.fileExists(filePath);
    if (!exists) {
      return {
        pass: false,
        message: () =>
          `expected file "${filePath}" to contain "${text}", but file does not exist`,
      };
    }
    const content = await received.readFile(filePath);
    const pass = content.includes(text);
    return {
      pass,
      message: () =>
        pass
          ? `expected file "${filePath}" not to contain "${text}"\n  Content: ${content}`
          : `expected file "${filePath}" to contain "${text}"\n  Content: ${content}`,
    };
  },

  toHaveRequestBody(
    received: CapturedExchange,
    expected: Record<string, unknown>,
  ) {
    const actualBody = received.request.body;
    const pass = matchesDeepPartial(actualBody, expected);

    return {
      pass,
      message: () => {
        if (pass) {
          return `expected request body not to match\n\nFull exchange:\n${formatExchangeContext(received)}`;
        }

        const expectedStr = JSON.stringify(expected, null, 2);
        const actualStr = JSON.stringify(actualBody, null, 2);
        const diff = `- Expected\n${expectedStr}\n\n+ Received\n${actualStr}`;

        return `expected request body to match\n\nDiff:\n${diff}\n\nFull exchange:\n${formatExchangeContext(received)}`;
      },
    };
  },

  toHaveResponseBody(
    received: CapturedExchange,
    expected: Record<string, unknown>,
  ) {
    const actualBody = received.response.body;
    const pass = matchesDeepPartial(actualBody, expected);

    return {
      pass,
      message: () => {
        if (pass) {
          return `expected response body not to match\n\nFull exchange:\n${formatExchangeContext(received)}`;
        }

        const expectedStr = JSON.stringify(expected, null, 2);
        const actualStr = JSON.stringify(actualBody, null, 2);
        const diff = `- Expected\n${expectedStr}\n\n+ Received\n${actualStr}`;

        return `expected response body to match\n\nDiff:\n${diff}\n\nFull exchange:\n${formatExchangeContext(received)}`;
      },
    };
  },

  toContainRequest(received: CapturedExchange[], matcher: RequestMatcher) {
    const match = received.find((exchange) => {
      if (matcher.path && !exchange.request.path.startsWith(matcher.path)) {
        return false;
      }
      if (matcher.method && exchange.request.method !== matcher.method) {
        return false;
      }
      if (
        matcher.bodyContaining &&
        !matchesDeepPartial(exchange.request.body, matcher.bodyContaining)
      ) {
        return false;
      }
      return true;
    });
    const pass = match !== undefined;

    const criteria = [
      matcher.path ? `path: "${matcher.path}"` : null,
      matcher.method ? `method: "${matcher.method}"` : null,
      matcher.bodyContaining
        ? `body containing: ${JSON.stringify(matcher.bodyContaining)}`
        : null,
    ]
      .filter((value): value is string => value !== null)
      .join(', ');

    return {
      pass,
      message: () =>
        pass
          ? `expected no exchange matching {${criteria}}\n\nAll captured exchanges:\n${formatExchangeList(received)}`
          : `expected at least one exchange matching {${criteria}}, but none found\n\nAll captured exchanges (${received.length}):\n${formatExchangeList(received)}`,
    };
  },

  toHaveToolInRequest(received: CapturedExchange, toolName: string) {
    const requestBody = received.request.body as
      | {
          tools?: Array<{
            function?: { name?: string };
          }>;
        }
      | undefined;
    const toolNames = (requestBody?.tools ?? [])
      .map((tool) => tool.function?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    const pass = toolNames.includes(toolName);
    const formattedContext = formatExchangeContext(received)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n');

    return {
      pass,
      message: () =>
        pass
          ? `expected request not to contain tool "${toolName}"\n  Tools present: [${toolNames.join(', ')}]\n${formattedContext}`
          : `expected request to contain tool "${toolName}"\n  Tools present: [${toolNames.join(', ')}]\n${formattedContext}`,
    };
  },

  toHaveToolCall(received: CapturedExchange, toolName: string) {
    const responseBody = received.response.body as
      | {
          choices?: Array<{
            message?: {
              tool_calls?: Array<{
                function?: { name?: string };
              }>;
            };
          }>;
        }
      | undefined;
    const callNames = (responseBody?.choices ?? [])
      .flatMap((choice) => choice.message?.tool_calls ?? [])
      .map((toolCall) => toolCall.function?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    const pass = callNames.includes(toolName);
    const formattedContext = formatExchangeContext(received)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n');

    return {
      pass,
      message: () =>
        pass
          ? `expected response not to have tool_call "${toolName}"\n  tool_calls present: [${callNames.join(', ')}]\n${formattedContext}`
          : `expected response to have tool_call "${toolName}"\n  tool_calls present: [${callNames.join(', ')}]\n${formattedContext}`,
    };
  },

  toHaveToolResult(
    received: CapturedExchange,
    toolName: string,
    contentMatcher?: string | RegExp,
  ) {
    const requestBody = received.request.body as
      | {
          messages?: RequestMessage[];
        }
      | undefined;
    const toolMessages = (requestBody?.messages ?? []).filter(
      (message) => message.role === 'tool',
    );
    const matchingToolMessages = toolMessages.filter(
      (message) => message.name === toolName,
    );
    const formattedContext = formatExchangeContext(received)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n');

    if (matchingToolMessages.length === 0) {
      const toolMessageList =
        toolMessages.length === 0
          ? '  (none)'
          : toolMessages
              .map((message) => {
                const name = message.name && message.name.length > 0
                  ? message.name
                  : '(unnamed)';
                const preview = truncate(
                  messageContentToString(message.content),
                  80,
                );
                return `  - ${name}: "${preview}"`;
              })
              .join('\n');

      return {
        pass: false,
        message: () =>
          `expected request to have tool result for "${toolName}", but no tool message with that name found\n\nTool messages in request:\n${toolMessageList}\n\nFull exchange:\n${formattedContext}`,
      };
    }

    if (contentMatcher === undefined) {
      return {
        pass: true,
        message: () =>
          `expected request not to have tool result for "${toolName}"\n\nFull exchange:\n${formattedContext}`,
      };
    }

    const contents = matchingToolMessages.map((message) =>
      messageContentToString(message.content),
    );
    const matchedContent = contents.find((content) =>
      matchesContent(content, contentMatcher),
    );
    const pass = matchedContent !== undefined;
    const actualContent = contents[0] ?? '';

    return {
      pass,
      message: () =>
        pass
          ? `expected tool result for "${toolName}" not to match ${String(contentMatcher)}\n  Actual content: "${matchedContent ?? ''}"\n\nFull exchange:\n${formattedContext}`
          : `expected tool result for "${toolName}" to match ${String(contentMatcher)}\n  Actual content: "${actualContent}"\n\nFull exchange:\n${formattedContext}`,
    };
  },

  async toHaveHealthyProxy(received: Container) {
    const log = await received.proxyLog();
    if (log === null) {
      return {
        pass: true,
        message: () => 'expected proxy not to be healthy, but proxy is not enabled',
      };
    }

    const hasListening = log.includes('Proxy server listening on');
    const hasErrors = log.includes('Error:');

    if (hasErrors) {
      return {
        pass: false,
        message: () => `expected healthy proxy, but proxy log contains errors\n\nProxy log:\n${log}`,
      };
    }

    if (!hasListening) {
      return {
        pass: false,
        message: () => `expected healthy proxy, but proxy log missing listening confirmation\n\nProxy log:\n${log}`,
      };
    }

    return {
      pass: true,
      message: () => `expected proxy not to be healthy\n\nProxy log:\n${log}`,
    };
  },
};

expect.extend(customMatchers as any);

declare module 'bun:test' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<T = unknown> {
    toHaveExitCode(code: number): void;
    toSucceedWith(text: string): void;
    toFail(): void;
    toFailWith(text: string): void;
    toHaveStdout(matcher: string | RegExp): void;
    toHaveStderr(matcher: string | RegExp): void;
    toHaveFile(path: string): Promise<void>;
    toHaveFileContaining(path: string, text: string): Promise<void>;
    toHaveRequestBody(expected: Record<string, unknown>): void;
    toHaveResponseBody(expected: Record<string, unknown>): void;
    toContainRequest(matcher: RequestMatcher): void;
    toHaveToolInRequest(toolName: string): void;
    toHaveToolCall(toolName: string): void;
    toHaveToolResult(toolName: string, contentMatcher?: string | RegExp): void;
    toHaveHealthyProxy(): Promise<void>;
  }
}
