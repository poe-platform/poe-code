import type { Readable, Writable } from "node:stream";

import {
  HttpTransport,
  type HttpTransportFetch,
  type OAuthClientProvider,
  type OAuthClientProviderOptions,
  type OAuthDiscoveryCache,
  type OAuthDiscoveryResult,
} from "./index.js";
import type { McpTransport, McpTransportClosedEvent } from "./index.js";

declare const readable: Readable;
declare const writable: Writable;

const closedEvent: McpTransportClosedEvent = {
  reason: new Error("transport closed"),
};

const transport: McpTransport = {
  readable,
  writable,
  closed: Promise.resolve(closedEvent),
  dispose(reason?: Error): void {
    void reason;
  },
};

const closed: Promise<McpTransportClosedEvent> = transport.closed;
const customFetch: HttpTransportFetch = async () => new Response(null, { status: 202 });
const oauthProvider: OAuthClientProvider = {
  authorizeRequest: async () => {},
  handleUnauthorized: async () => ({ action: "retry" }),
};
const oauthOptions: OAuthClientProviderOptions = {
  provider: oauthProvider,
};
const oauthDiscoveryResult: OAuthDiscoveryResult = {
  resource: "https://example.com/mcp",
  resourceMetadataUrl: "https://example.com/.well-known/oauth-protected-resource/mcp",
  resourceMetadata: {
    resource: "https://example.com/mcp",
    authorization_servers: ["https://auth.example.com"],
  },
  authorizationServer: "https://auth.example.com",
  authorizationServerMetadataUrl:
    "https://auth.example.com/.well-known/oauth-authorization-server",
  authorizationServerMetadata: {
    issuer: "https://auth.example.com",
    authorization_endpoint: "https://auth.example.com/authorize",
    token_endpoint: "https://auth.example.com/token",
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
  },
};
const oauthDiscoveryCache: OAuthDiscoveryCache = {
  get: () => oauthDiscoveryResult,
  set: () => {},
};
const httpTransport: McpTransport = new HttpTransport({
  url: "https://example.com/mcp",
  headers: {
    Authorization: "Bearer test",
  },
  fetch: customFetch,
  oauth: oauthOptions,
  oauthDiscoveryCache,
});

// @ts-expect-error reason must be an Error.
const invalidClosedEvent: McpTransportClosedEvent = { reason: "closed" };

void closed;
void httpTransport;
void invalidClosedEvent;
