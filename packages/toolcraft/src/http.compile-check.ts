import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import {
  createHTTPMCPServer,
  runHTTPMCP,
  type RunHTTPMCPOptions,
  type ToolcraftHTTPContext,
  type ToolcraftHTTPServer,
  type ToolcraftHTTPServerHandle
} from "./http.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

interface Services {
  requester: string;
}

const ignoredRoot = defineGroup<Services>({
  name: "root",
  children: [
    defineCommand<Services>({
      name: "whoami",
      params: S.Object({}),
      handler: async ({ requester }) => requester
    })
  ]
});

const ignoredOptions = {
  name: "toolcraft-http-test",
  version: "1.0.0",
  hostname: "127.0.0.1",
  port: 0,
  path: "/mcp",
  enableJsonResponse: true,
  allowedHosts: ["127.0.0.1"],
  allowedOrigins: ["https://example.com"],
  maxRequestBytes: 1_000_000,
  maxConcurrentToolCalls: 4,
  requestTimeoutMs: 30_000,
  requestServices(context: ToolcraftHTTPContext) {
    return { requester: context.auth?.subject ?? "anonymous" };
  }
} satisfies RunHTTPMCPOptions<Services>;

const ignoredServer = createHTTPMCPServer(ignoredRoot, ignoredOptions);
const ignoredHandle = runHTTPMCP(ignoredRoot, ignoredOptions);

type ignoredServerExport = AssertAssignable<Promise<ToolcraftHTTPServer>, typeof ignoredServer>;
type ignoredHandleExport = AssertAssignable<Promise<ToolcraftHTTPServerHandle>, typeof ignoredHandle>;
