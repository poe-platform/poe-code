import { createServer, parseUriTemplate, type HandlerRequestContext } from "../src/index.js";
import { PassThrough } from "node:stream";

const server = createServer({ name: "typed", version: "1", validateToolArguments: true });
server.tool<{ message: string }>("echo", "Echo", { type: "object" }, (args, context) => {
  const signal: AbortSignal = context.signal;
  const state: string | undefined = context.requestState;
  return [args.message, signal.aborted, state];
});
server.registerTool(
  { name: "other", inputSchema: { type: "object" } },
  (_args, context: HandlerRequestContext) => context.clientCapabilities
);
const removed: boolean = server.removeTool("other");
const session = server.createMessageSession();
void session.handleMessage("ping", undefined, { requestId: 1 });
void server.handleMessage("ping");
session.close();
void removed;
void server.connect({ readable: new PassThrough(), writable: new PassThrough() });
void server.listen();
const line: Promise<string | undefined> = server
  .createMessageSession()
  .handleLine('{"jsonrpc":"2.0","id":1,"method":"ping"}');
void line;
const template = parseUriTemplate("memo://{name}");
const expanded: string = template.expand({ name: "a b" });
const captured: Record<string, string> | null = template.match(expanded);
void captured;
server.prompt(
  { name: "review", arguments: [{ name: "code", required: true }] },
  (args, context) => ({
    messages: [
      { role: "user", content: { type: "text", text: args.code + context.signal.aborted } }
    ]
  })
);
server.resource({ uri: "memo://welcome", name: "welcome" }, (uri) => ({
  contents: [{ uri, text: "hello" }]
}));
server.resourceTemplate({ uriTemplate: "memo://{name}", name: "memo" }, (uri) => ({
  contents: [{ uri, text: uri }]
}));
server.method("custom/value", (params, context) => ({
  value: params?.value,
  aborted: context.signal.aborted
}));
const removedPrompt: boolean = server.removePrompt("review");
void removedPrompt;
