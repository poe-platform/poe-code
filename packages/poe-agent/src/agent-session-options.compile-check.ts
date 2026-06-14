import type {
  AgentSession,
  ChatMessage,
  CreateAgentSessionOptions,
  McpServerDefinition,
  SessionEntry
} from "./index.js";

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
    persist: { directory: string };
  }
>;

type ignoredCreateAgentSessionOptionsAllowsPlugins = AssertAssignable<
  CreateAgentSessionOptions,
  {
    model: string;
    plugins: [];
  }
>;

type ignoredCreateAgentSessionOptionsAllowsPluginsConfig = AssertAssignable<
  CreateAgentSessionOptions,
  {
    model: string;
    pluginsConfig: [{ name: "web" }];
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

declare const session: AgentSession;
declare const entryId: string;

const ignoredSessionId: string = session.id;
const ignoredHistory: ChatMessage[] = session.getHistory();
const ignoredTree: SessionEntry[] = session.tree();
const ignoredFork: Promise<AgentSession> = session.fork(entryId);
const ignoredNavigation: Promise<void> = session.navigateTo(entryId);

void ignoredSessionId;
void ignoredHistory;
void ignoredTree;
void ignoredFork;
void ignoredNavigation;
