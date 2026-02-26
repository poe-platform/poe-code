import type {
  McpHttpServerDefinition,
  McpServerDefinition,
  McpStdioServerDefinition,
} from "./index.js";
import type {
  McpHttpServerDefinition as InternalMcpHttpServerDefinition,
  McpServerDefinition as InternalMcpServerDefinition,
  McpStdioServerDefinition as InternalMcpStdioServerDefinition,
} from "./mcp-tool-executor.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

type ignoredPublicMcpServerDefinitionMatchesInternal = AssertAssignable<
  InternalMcpServerDefinition,
  McpServerDefinition
>;

type ignoredPublicMcpStdioServerDefinitionMatchesInternal = AssertAssignable<
  InternalMcpStdioServerDefinition,
  McpStdioServerDefinition
>;

type ignoredPublicMcpHttpServerDefinitionMatchesInternal = AssertAssignable<
  InternalMcpHttpServerDefinition,
  McpHttpServerDefinition
>;
