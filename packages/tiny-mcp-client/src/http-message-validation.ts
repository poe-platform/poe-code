import { parseJsonRpcMessage, type JsonRpcRequest } from "./internal.js";

const subscriptionMethods = new Set([
  "notifications/subscriptions/acknowledged",
  "notifications/tools/list_changed",
  "notifications/prompts/list_changed",
  "notifications/resources/list_changed",
  "notifications/resources/updated"
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class HttpResponseMessages {
  completed = false;
  private acknowledged = false;

  constructor(private readonly request: JsonRpcRequest) {}

  validate(line: string, allowNotifications: boolean): string {
    if (this.completed) throw new Error("MCP HTTP message arrived after completion");
    let parsed = parseJsonRpcMessage(line);
    if (parsed.type === "invalid") {
      try {
        const raw: unknown = JSON.parse(line);
        if (
          record(raw) &&
          raw.jsonrpc === "2.0" &&
          (!Object.prototype.hasOwnProperty.call(raw, "id") || raw.id === null) &&
          !Object.prototype.hasOwnProperty.call(raw, "method") &&
          !Object.prototype.hasOwnProperty.call(raw, "result")
        ) {
          const normalized = JSON.stringify({ ...raw, id: this.request.id });
          parsed = parseJsonRpcMessage(normalized);
          if (parsed.type === "response") line = normalized;
        }
      } catch {
        /* Invalid envelopes are rejected below. */
      }
    }
    if (parsed.type === "response") {
      if (parsed.message.id !== this.request.id)
        throw new Error("MCP HTTP response ID does not match its originating request");
      if (this.request.method === "subscriptions/listen" && "result" in parsed.message) {
        const result = parsed.message.result;
        const metadata = record(result) && record(result._meta) ? result._meta : undefined;
        if (
          !this.acknowledged ||
          metadata?.["io.modelcontextprotocol/subscriptionId"] !== this.request.id
        ) {
          throw new Error("Invalid MCP HTTP subscription completion");
        }
      }
      this.completed = true;
      return line;
    }
    if (!allowNotifications || parsed.type !== "notification") {
      throw new Error("Modern MCP HTTP responses cannot contain requests or invalid messages");
    }
    const params = parsed.message.params;
    const metadata = record(params) && record(params._meta) ? params._meta : undefined;
    const subscriptionId = metadata?.["io.modelcontextprotocol/subscriptionId"];
    const method = parsed.message.method;
    if (this.request.method === "subscriptions/listen") {
      if (subscriptionId !== this.request.id || !subscriptionMethods.has(method)) {
        throw new Error("MCP HTTP notification does not match its originating subscription");
      }
      if (!this.acknowledged) {
        if (method !== "notifications/subscriptions/acknowledged")
          throw new Error("MCP HTTP subscription notification arrived before acknowledgement");
        this.acknowledged = true;
      } else if (method === "notifications/subscriptions/acknowledged") {
        throw new Error("MCP HTTP subscription was acknowledged more than once");
      }
    } else {
      if (subscriptionId !== undefined || subscriptionMethods.has(method)) {
        throw new Error(
          "Subscription notifications require their originating HTTP subscription stream"
        );
      }
      if (method === "notifications/progress") {
        const requestedParams = this.request.params;
        const requestedMetadata =
          record(requestedParams) && record(requestedParams._meta)
            ? requestedParams._meta
            : undefined;
        const token = requestedMetadata?.progressToken;
        if (token === undefined || !record(params) || params.progressToken !== token) {
          throw new Error("MCP HTTP progress token does not match its originating request");
        }
      }
    }
    return line;
  }
}
