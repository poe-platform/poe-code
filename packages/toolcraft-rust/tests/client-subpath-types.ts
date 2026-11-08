import * as native from "toolcraft-rust/tiny-mcp-client";
import * as reference from "toolcraft/tiny-mcp-client";

type Public<T> = { [K in keyof T]: T[K] };
declare const ownClient: Public<native.McpClient>;
declare const referenceClient: Public<reference.McpClient>;
const clientForward: Public<reference.McpClient> = ownClient;
const clientReverse: Public<native.McpClient> = referenceClient;
const pairForward: typeof reference.createTestPair = native.createTestPair;
const pairReverse: typeof native.createTestPair = reference.createTestPair;
const sdkPairForward: typeof reference.createSdkTestPair = native.createSdkTestPair;
const sdkPairReverse: typeof native.createSdkTestPair = reference.createSdkTestPair;
const capabilities: native.ClientCapabilities = { roots: { listChanged: true } };
const client = new native.McpClient({
  clientInfo: { name: "consumer", version: "1" },
  capabilities
});
const transport: reference.McpTransport = new native.HttpTransport({
  url: "https://example.com/mcp"
});
const stdio: reference.McpTransport = new native.StdioTransport({ command: "server" });
const discovered: native.Tool[] = (await client.listTools()).tools;
const tools: reference.Tool[] = discovered;
declare const session: native.StoredOAuthSession;
const referenceSession: reference.StoredOAuthSession = session;
// @ts-expect-error Native-only diagnostics are not part of the Toolcraft facade.
void native.parseJsonRpcMessage;
// @ts-expect-error Discovered tools preserve the public schema type.
const invalid: number = discovered[0].inputSchema;
void [
  clientForward,
  clientReverse,
  pairForward,
  pairReverse,
  sdkPairForward,
  sdkPairReverse,
  transport,
  stdio,
  tools,
  referenceSession,
  invalid
];
