import { createServer, type HandlerRequestContext } from "../src/index.js";

const server = createServer({ name: "typed", version: "1" });
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
