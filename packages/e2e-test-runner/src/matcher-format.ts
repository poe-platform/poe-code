import type { CapturedExchange } from './proxy-types.js';

type RequestBody = {
  model?: string;
  messages?: RequestMessage[];
  tools?: RequestTool[];
};

type ResponseBody = {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: ResponseToolCall[];
    };
  }>;
};

type RequestMessage = {
  role?: string;
  content?: unknown;
  name?: string;
};

type RequestTool = {
  function?: {
    name?: string;
  };
};

type ResponseToolCall = {
  function?: {
    name?: string;
  };
};

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function getMessagePreview(message: RequestMessage): string {
  if (typeof message.content !== 'string') {
    return '(no content)';
  }
  return truncate(message.content, 60);
}

function getResponseContentPreview(responseBody: ResponseBody | undefined): string {
  const content = responseBody?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    return '(none)';
  }
  return truncate(content, 100);
}

export function formatExchangeList(exchanges: CapturedExchange[]): string {
  if (exchanges.length === 0) {
    return '  (no captured exchanges)';
  }

  return exchanges
    .map((exchange, index) => {
      const requestBody = exchange.request.body as RequestBody | undefined;
      return `[${index}] ${exchange.request.method} ${exchange.request.path} → ${exchange.response.status} (model: ${requestBody?.model ?? '(none)'}, tools: ${requestBody?.tools?.length ?? 0})`;
    })
    .join('\n');
}

export function formatExchangeContext(exchange: CapturedExchange): string {
  const requestBody = exchange.request.body as RequestBody | undefined;
  const responseBody = exchange.response.body as ResponseBody | undefined;
  const messages = requestBody?.messages ?? [];
  const requestToolNames = (requestBody?.tools ?? [])
    .map((tool) => tool.function?.name)
    .filter((toolName): toolName is string => Boolean(toolName));
  const responseToolCallNames = (responseBody?.choices?.[0]?.message?.tool_calls ?? [])
    .map((toolCall) => toolCall.function?.name)
    .filter((toolName): toolName is string => Boolean(toolName));
  const lines = [
    `Route: ${exchange.route}`,
    `Request: ${exchange.request.method} ${exchange.request.path} -> ${exchange.response.status}`,
    `Timestamp: ${exchange.timestamp}`,
    'Request body:',
    `  model: ${requestBody?.model ?? '(none)'}`,
    `  messages (${messages.length}):`,
  ];

  if (messages.length === 0) {
    lines.push('    (none)');
  } else {
    messages.forEach((message, index) => {
      const role = message.role ?? '(unknown role)';
      const nameTag = message.name ? ` [name: ${message.name}]` : '';
      lines.push(`    - [${index}] ${role}${nameTag}: "${getMessagePreview(message)}"`);
    });
  }

  lines.push(
    `  tools (${requestToolNames.length}): ${requestToolNames.join(', ') || '(none)'}`,
    'Response body:',
    `  tool_calls (${responseToolCallNames.length}): ${responseToolCallNames.join(', ') || '(none)'}`,
    `  content: "${getResponseContentPreview(responseBody)}"`,
  );

  return lines.join('\n');
}
