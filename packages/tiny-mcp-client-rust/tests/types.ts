import { PassThrough } from "node:stream";
import {
  McpClient,
  JsonRpcMessageLayer,
  McpError,
  type JsonRpcRequestOptions,
  type McpRequestContext
} from "../src/index.js";
const layer = new JsonRpcMessageLayer(new PassThrough(), new PassThrough(), 1000, undefined, 4);
const options: JsonRpcRequestOptions = {
  timeoutMs: null,
  onRequestId: (id) => {
    void id;
  }
};
void layer.sendRequest("ping", {}, options);
layer.onRequest("callback", (_params, context: McpRequestContext) => {
  const signal: AbortSignal = context.signal;
  void signal;
  return {};
});
layer.onInputRequest("roots/list", () => ({ roots: [] }));
layer.onNotification("changed", (_params, context) => {
  const method: string = context.method;
  void method;
});
const canceled: boolean = layer.cancelRequest("unknown", new McpError(-32603, "stop"));
void canceled;
layer.dispose();

const client = new McpClient({
  clientInfo: { name: "typed-client", version: "1" },
  onRootsList: (context) => {
    const signal: AbortSignal = context.signal;
    void signal;
    return [{ uri: "file:///workspace", name: "workspace" }];
  },
  onSamplingRequest: (params) => ({
    role: "assistant", model: "mock", content: { type: "text", text: String(params.maxTokens) }
  })
});
void client.listTools().then(({ tools }) => tools.map((tool) => tool.name));
void client.callTool({ name: "echo", arguments: { message: "hello" } }, { progressToken: "p" });
void client.getPrompt({ name: "review" }).then(({ messages }) => messages[0]?.role);
void client.complete({ ref: { type: "ref/prompt", name: "review" }, argument: { name: "topic", value: "r" } });
void client.close();
void client.subscribe("file:///workspace");
void client.unsubscribe("file:///workspace");
void client.listenNotifications({ toolsListChanged: true }).then(subscription => {
  const closed: Promise<void> = subscription.closed;
  void closed;
  subscription.cancel();
});
