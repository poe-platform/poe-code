import type {
  ClientCapabilities,
  Implementation,
  InitializeParams,
  InitializeResult,
  McpClientOptions,
  McpProtocolVersion,
  ServerCapabilities,
} from "./index.js";

const implementation: Implementation = {
  name: "tiny-mcp-client",
  version: "0.1.0",
};

const clientCapabilities: ClientCapabilities = {
  roots: {},
  sampling: {},
  experimental: {
    supportsFastPath: true,
  },
};

const serverCapabilities: ServerCapabilities = {
  prompts: {},
  resources: {},
  tools: {},
  logging: {},
  completions: {},
  experimental: {
    rollout: "beta",
  },
};

const initializeParams: InitializeParams = {
  protocolVersion: "2025-03-26",
  capabilities: clientCapabilities,
  clientInfo: implementation,
};

const initializeResult: InitializeResult = {
  protocolVersion: "2025-03-26",
  capabilities: serverCapabilities,
  serverInfo: implementation,
  instructions: "Do not execute destructive tools without confirmation.",
};

const legacyRevision: McpProtocolVersion = "2025-11-25";
const pinnedClientOptions: McpClientOptions = { clientInfo: implementation, protocolVersion: legacyRevision };
const juneClientOptions: McpClientOptions = { clientInfo: implementation, protocolVersion: "2025-06-18" };
// @ts-expect-error Unsupported protocol revisions must not silently select automatic negotiation.
const unsupportedClientOptions: McpClientOptions = { clientInfo: implementation, protocolVersion: "2099-01-01" };

// @ts-expect-error Implementation.version is required.
const implementationMissingVersion: Implementation = { name: "tiny-mcp-client" };

// @ts-expect-error InitializeParams.protocolVersion is required.
const initializeParamsMissingProtocolVersion: InitializeParams = {
  capabilities: clientCapabilities,
  clientInfo: implementation,
};

// @ts-expect-error InitializeResult.capabilities is required.
const initializeResultMissingCapabilities: InitializeResult = {
  protocolVersion: "2025-03-26",
  serverInfo: implementation,
};

void implementationMissingVersion;
void initializeParamsMissingProtocolVersion;
void initializeResultMissingCapabilities;
void initializeParams;
void initializeResult;
void pinnedClientOptions;
void juneClientOptions;
void unsupportedClientOptions;
