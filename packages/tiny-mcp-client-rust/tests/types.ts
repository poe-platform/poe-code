import { PassThrough } from "node:stream";
import { createTestPair as referencePair, createSdkTestPair as referenceSdkPair } from "tiny-mcp-client";
import type { McpClientConnection as ReferenceConnection } from "tiny-mcp-client";
import type { McpClientConnection } from "../dist/index.js";
declare const connection: McpClientConnection;
declare const referenceConnection: ReferenceConnection;
const connectionToReference: ReferenceConnection = connection;
const connectionFromReference: McpClientConnection = referenceConnection;
const pairToReference: typeof referencePair = createTestPair;
const pairFromReference: typeof createTestPair = referencePair;
const sdkPairToReference: typeof referenceSdkPair = createSdkTestPair;
const sdkPairFromReference: typeof createSdkTestPair = referenceSdkPair;
void [connectionToReference, connectionFromReference, pairToReference,
  pairFromReference, sdkPairToReference, sdkPairFromReference];
import type { ClientCapabilities, Tool, StoredOAuthSession } from "../dist/index.js";
import type {
  ClientCapabilities as ReferenceCapabilities,
  Tool as ReferenceTool,
  StoredOAuthSession as ReferenceSession
} from "tiny-mcp-client";
declare const capabilities: ClientCapabilities;
declare const referenceCapabilities: ReferenceCapabilities;
declare const tool: Tool;
declare const referenceTool: ReferenceTool;
declare const session: StoredOAuthSession;
declare const referenceSession: ReferenceSession;
const capabilitiesToReference: ReferenceCapabilities = capabilities;
const capabilitiesFromReference: ClientCapabilities = referenceCapabilities;
const toolToReference: ReferenceTool = tool;
const toolFromReference: Tool = referenceTool;
const sessionToReference: ReferenceSession = session;
const sessionFromReference: StoredOAuthSession = referenceSession;
type Assert<T extends true> = T;
type IsTyped<T> = 0 extends (1 & T) ? false : true;
export type PublicDeclarationsAreTyped = [
  Assert<IsTyped<ClientCapabilities>>,
  Assert<IsTyped<Tool>>,
  Assert<IsTyped<StoredOAuthSession>>,
  Assert<IsTyped<Awaited<ReturnType<McpClient["listTools"]>>["tools"][number]>>
];
// @ts-expect-error Capability flags must retain their boolean contract.
const invalidCapabilities: ClientCapabilities = { roots: { listChanged: "yes" } };
// @ts-expect-error Tool schemas must remain records.
const invalidTool: Tool = { name: "echo", inputSchema: 42 };
void [capabilitiesToReference, capabilitiesFromReference, toolToReference,
  toolFromReference, sessionToReference, sessionFromReference, invalidCapabilities, invalidTool];
import {defaultStdioSpawn, snapshotHttpTransportHeaders} from "../dist/index.js";
import {defaultStdioSpawn as referenceSpawn, snapshotHttpTransportHeaders as referenceHeaders} from "tiny-mcp-client";
const spawnToReference:typeof referenceSpawn=defaultStdioSpawn;
const spawnFromReference:typeof defaultStdioSpawn=referenceSpawn;
const headersToReference:typeof referenceHeaders=snapshotHttpTransportHeaders;
const headersFromReference:typeof snapshotHttpTransportHeaders=referenceHeaders;
void [spawnToReference,spawnFromReference,headersToReference,headersFromReference];
import { parseBearerWwwAuthenticateHeader } from "../dist/index.js";
import type { OAuthUnauthorizedChallenge as ReferenceChallenge } from "tiny-mcp-client";
import type { OAuthUnauthorizedChallenge } from "../dist/index.js";
declare const referenceChallenge: ReferenceChallenge;
declare const ownChallenge: OAuthUnauthorizedChallenge;
const challengeToReference: ReferenceChallenge = ownChallenge;
const challengeFromReference: OAuthUnauthorizedChallenge = referenceChallenge;
void challengeToReference;
void challengeFromReference;
void parseBearerWwwAuthenticateHeader(null);
import { discoverOAuthMetadata, OAuthMetadataDiscovery, fetchMcpResponse } from "../dist/index.js";
import { discoverOAuthMetadata as referenceDiscover, OAuthMetadataDiscovery as ReferenceDiscovery, fetchMcpResponse as referenceFetch } from "tiny-mcp-client";
const fetchToReference: typeof referenceFetch = fetchMcpResponse;
const fetchFromReference: typeof fetchMcpResponse = referenceFetch;
void fetchToReference;
void fetchFromReference;
const discoveryToReference: typeof referenceDiscover = discoverOAuthMetadata;
const discoveryFromReference: typeof discoverOAuthMetadata = referenceDiscover;
const ownLookup: ReferenceDiscovery["discover"] = new OAuthMetadataDiscovery().discover;
const referenceLookup: OAuthMetadataDiscovery["discover"] = new ReferenceDiscovery().discover;
void discoveryToReference;
void discoveryFromReference;
void ownLookup;
void referenceLookup;
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
} from "../dist/index.js";
import { HttpTransport, type HttpTransportOptions } from "../dist/index.js";
import { MCP_PROTOCOL_VERSIONS } from "../dist/index.js";
import { MCP_PROTOCOL_VERSIONS as referenceVersions, type McpProtocolVersion as ReferenceVersion } from "tiny-mcp-client";
const versionsA: typeof referenceVersions = MCP_PROTOCOL_VERSIONS;
const versionsB: typeof MCP_PROTOCOL_VERSIONS = referenceVersions;
const supportedLegacy: ReferenceVersion = "2025-11-25";
void [versionsA, versionsB, supportedLegacy];
const completeInitialization: ReferenceHttpTransport["completeInitialization"] = new HttpTransport({ url: "https://resource.example/mcp" }).completeInitialization;
const ownCompleteInitialization: HttpTransport["completeInitialization"] = new ReferenceHttpTransport({ url: "https://resource.example/mcp" }).completeInitialization;
void completeInitialization;
void ownCompleteInitialization;
import { HttpTransport as ReferenceHttpTransport, type HttpTransportOptions as ReferenceHttpOptions } from "tiny-mcp-client";
declare const ownHttpOptions: HttpTransportOptions;
declare const referenceHttpOptions: ReferenceHttpOptions;
const httpOptionsToReference: ReferenceHttpOptions = ownHttpOptions;
const httpOptionsFromReference: HttpTransportOptions = referenceHttpOptions;
const ownHttpTransport: Pick<ReferenceHttpTransport, "readable" | "writable" | "closed" | "filterTools" | "dispose"> = new HttpTransport(ownHttpOptions);
const referenceHttpTransport: HttpTransport = new ReferenceHttpTransport(referenceHttpOptions);
void httpOptionsToReference;
void httpOptionsFromReference;
void ownHttpTransport;
void referenceHttpTransport;
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
void createSdkTestPair(new OfficialServer({ name: "official", version: "1" }), () => connection);
void createTestPair(createServer({ name: "own", version: "1" }), () => connection);
// @ts-expect-error The reference helper requires a void-returning connection.
void referencePair(createServer({ name: "own", version: "1" }), () => client);
// @ts-expect-error Preserve the reference helper's void-returning connection constraint.
void createTestPair(createServer({ name: "own", version: "1" }), () => client);
// @ts-expect-error A server must expose the complete public stdio server contract.
void createTestPair({ async connect() {} }, () => connection);
// @ts-expect-error SDK server connection completion must return void.
void createSdkTestPair({ async connect() { return 1; } }, () => connection);
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
