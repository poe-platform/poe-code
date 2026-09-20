import { PassThrough } from "node:stream";
import {
  McpClient,
  StdioTransport,
  createInMemoryTransportPair,
  createSdkTestPair,
  createTestPair,
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
import { Server as OfficialServer } from "@modelcontextprotocol/sdk/server/index.js";
import { createServer } from "tiny-stdio-mcp-server-rust";
void createSdkTestPair(new OfficialServer({ name: "official", version: "1" }), () => client);
void createTestPair(createServer({ name: "own", version: "1" }), () => client);
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
const pair = createInMemoryTransportPair();
void client.connect(pair.clientTransport);
const stdio = new StdioTransport({ command: "mock", args: ["--stdio"], env: { TASK: "yes" } });
const stderr: string = stdio.getStderrOutput();
void stderr;
stdio.dispose();
void client.unsubscribe("file:///workspace");
void client.listenNotifications({ toolsListChanged: true }).then(subscription => {
  const closed: Promise<void> = subscription.closed;
  void closed;
  subscription.cancel();
});
