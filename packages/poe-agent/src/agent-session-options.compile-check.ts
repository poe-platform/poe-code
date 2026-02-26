import type { CreateAgentSessionOptions } from "./agent-session.js";
import type { McpServerDefinition } from "./mcp-tool-executor.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

type ignoredCreateAgentSessionOptionsStillAllowsExistingFields = AssertAssignable<
  CreateAgentSessionOptions,
  {
    model: string;
    apiKey: string;
    cwd: string;
    allowedPaths: string[];
    baseUrl: string;
    maxToolCallIterations: number;
  }
>;

type ignoredCreateAgentSessionOptionsMcpServersType = AssertAssignable<
  Record<string, McpServerDefinition> | undefined,
  CreateAgentSessionOptions["mcpServers"]
>;

type ignoredCreateAgentSessionOptionsMcpServersIsOptional = AssertAssignable<
  CreateAgentSessionOptions,
  {
    model: string;
  }
>;
