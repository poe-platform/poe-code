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
