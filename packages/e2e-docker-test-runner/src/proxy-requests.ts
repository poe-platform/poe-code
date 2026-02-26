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

type RequestTool = {
  function?: {
    name?: string;
  };
};

type ResponseToolCall = {
  function?: {
    name?: string;
    arguments?: string;
  };
};

export type RequestMessage = {
  role: string;
  content?: string;
  name?: string;
  tool_call_id?: string;
};

export class CapturedRequests {
  readonly #exchanges: CapturedExchange[];

  constructor(exchanges: CapturedExchange[]) {
    this.#exchanges = exchanges;
  }

  get length(): number {
    return this.#exchanges.length;
  }

  at(index: number): CapturedExchange {
    const exchange = this.#exchanges[index];
    if (exchange === undefined) {
      throw new Error(
        `No captured request at index ${index}. Only ${this.#exchanges.length} request(s) captured:\n${this.summary()}`,
      );
    }
    return exchange;
  }

  all(): CapturedExchange[] {
    return [...this.#exchanges];
  }

  forRoute(path: string): CapturedRequests {
    return new CapturedRequests(
      this.#exchanges.filter((exchange) => exchange.request.path.startsWith(path)),
    );
  }

  withToolCalls(): CapturedRequests {
    return new CapturedRequests(
      this.#exchanges.filter((exchange) => this.getResponseToolCalls(exchange).length > 0),
    );
  }

  withToolResults(): CapturedRequests {
    return new CapturedRequests(
      this.#exchanges.filter((exchange) =>
        this.getRequestMessages(exchange).some((message) => message.role === 'tool'),
      ),
    );
  }

  toolNamesAt(index: number): string[] {
    const requestBody = this.at(index).request.body as RequestBody | undefined;
    return (requestBody?.tools ?? [])
      .map((tool) => tool.function?.name)
      .filter((name): name is string => Boolean(name));
  }

  toolCallsAt(index: number): Array<{ name: string; arguments: Record<string, unknown> }> {
    return this.getResponseToolCalls(this.at(index))
      .map((toolCall) => {
        const name = toolCall.function?.name;
        const argumentsJson = toolCall.function?.arguments;
        if (!name || !argumentsJson) {
          return null;
        }
        return {
          name,
          arguments: JSON.parse(argumentsJson) as Record<string, unknown>,
        };
      })
      .filter((toolCall): toolCall is { name: string; arguments: Record<string, unknown> } => toolCall !== null);
  }

  messagesAt(index: number): RequestMessage[] {
    return this.getRequestMessages(this.at(index));
  }

  toolResultAt(index: number, toolName: string): { content: string; tool_call_id: string } | undefined {
    const message = this.messagesAt(index).find(
      (candidate) => candidate.role === 'tool' && candidate.name === toolName,
    );
    if (!message) {
      return undefined;
    }
    return {
      content: message.content ?? '',
      tool_call_id: message.tool_call_id ?? '',
    };
  }

  summary(): string {
    if (this.#exchanges.length === 0) {
      return '  (no captured requests)';
    }

    return this.#exchanges
      .map((exchange, index) => {
        const requestBody = exchange.request.body as RequestBody | undefined;
        const responseMessage = (exchange.response.body as ResponseBody | undefined)?.choices?.[0]?.message;
        const lines = [
          `  [${index}] ${exchange.request.method} ${exchange.request.path} (${exchange.response.status})`,
          `      model: ${requestBody?.model ?? '(none)'}`,
          `      messages: ${requestBody?.messages?.length ?? 0} messages`,
          `      tools: ${requestBody?.tools?.length ?? 0} tool definitions`,
        ];

        if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
          const names = responseMessage.tool_calls
            .map((toolCall) => toolCall.function?.name)
            .filter((name): name is string => Boolean(name));
          lines.push(`      response tool_calls: [${names.join(', ')}]`);
        }

        if (responseMessage?.content) {
          const content =
            responseMessage.content.length > 80
              ? `${responseMessage.content.slice(0, 80)}...`
              : responseMessage.content;
          lines.push(`      response content: "${content}"`);
        }

        return lines.join('\n');
      })
      .join('\n');
  }

  debugAt(index: number): string {
    return JSON.stringify(this.at(index), null, 2);
  }

  private getRequestMessages(exchange: CapturedExchange): RequestMessage[] {
    const requestBody = exchange.request.body as RequestBody | undefined;
    return requestBody?.messages ?? [];
  }

  private getResponseToolCalls(exchange: CapturedExchange): ResponseToolCall[] {
    const responseBody = exchange.response.body as ResponseBody | undefined;
    return responseBody?.choices?.[0]?.message?.tool_calls ?? [];
  }
}
