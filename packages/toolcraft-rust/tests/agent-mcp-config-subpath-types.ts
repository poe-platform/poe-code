import * as native from "toolcraft-rust/agent-mcp-config";
import * as reference from "toolcraft/agent-mcp-config";
const own: typeof reference = native;
const original: typeof native = reference;
declare const options: native.ApplyOptions;
const referenceOptions: reference.ApplyOptions = options;
const ownOptions: native.ApplyOptions = referenceOptions;
const server: native.McpServerEntry = { name: "tools", config: { transport: "stdio", command: "node", args: ["tools.mjs"] } };
const http: native.McpHttpServer = { transport: "http", url: "https://example.test/mcp" };
const stdio: native.McpStdioServer = { transport: "stdio", command: "node" };
const config: native.McpServerConfig = http;
const configured: Promise<void> = native.configure("claude", server, options);
const removed: Promise<void> = native.unconfigure("claude", "tools", options);
// @ts-expect-error additional native-only type names are not public Toolcraft exports
type Extra = native.AgentMcpConfig;
// @ts-expect-error public platform is a closed union
native.configure("claude", server, { ...options, platform: "other" });
// @ts-expect-error stdio server needs its command
const invalid: native.McpStdioServer = { transport: "stdio" };
void [own, original, ownOptions, configured, removed, stdio, config, invalid];
type UsedExtra = Extra;
export type { UsedExtra };
