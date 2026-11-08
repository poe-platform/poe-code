import type {
  AgentPlugin,
  HookDecision,
  InputDecision,
  IterationContext,
  Logger,
  McpServerConfig,
  NotificationContext,
  PostCompactionContext,
  PreCompactionContext,
  PluginApi,
  Provider,
  ProviderContext,
  PromptContext,
  SessionStartContext,
  StopContext,
  ToolCallDecision,
  ToolResultDecision,
  ToolUseContext,
  UserPromptSubmitContext
} from "./plugin-types.js";
import type { McpSpawnServer } from "@poe-code/agent-spawn";
import type { AcpModel } from "./acp-core.js";
import type { Tool } from "./types.js";

declare const tool: Tool;
declare const toolUseContext: ToolUseContext;
declare const iterationContext: IterationContext;
declare const sessionStartContext: SessionStartContext;
declare const userPromptSubmitContext: UserPromptSubmitContext;
declare const preCompactionContext: PreCompactionContext;
declare const postCompactionContext: PostCompactionContext;
declare const notificationContext: NotificationContext;
declare const stopContext: StopContext;
declare const pluginApi: PluginApi;
declare const providerContext: ProviderContext;
declare const logger: Logger;

type Assert<T extends true> = T;
type AssertExact<Actual, Expected> =
  (<T>() => T extends Actual ? 1 : 2) extends <T>() => T extends Expected ? 1 : 2 ? true : false;
type ignoredIterationCompactionOptionKeys = Assert<
  AssertExact<
    keyof import("./plugin-types.js").IterationCompactionOptions,
    "contextWindow" | "keepLastTurns" | "summarise" | "threshold"
  >
>;

const hookDecisions: HookDecision[] = [
  undefined,
  "skip",
  "abort"
];
const inputDecisions: InputDecision[] = [
  undefined,
  "abort",
  { action: "transform", prompt: "redacted prompt" },
  { action: "handled", response: "handled response" }
];
const toolCallDecisions: ToolCallDecision[] = [
  undefined,
  "skip",
  "abort",
  { block: true, reason: "missing permission" },
  { rewrite: { args: { path: "README.md" } } },
  { reject: "legacy missing permission" }
];
const toolResultDecisions: ToolResultDecision[] = [
  undefined,
  "abort",
  { replace: { content: "redacted" } }
];

const promptContext: PromptContext = {
  userPrompt: "fix this bug"
};

const mcpConfig: McpServerConfig = {
  name: "repo-tools",
  command: "node",
  args: ["server.js"],
  env: { NODE_ENV: "test" },
  visibility: "skill"
};

const provider: Provider = {
  name: "example-provider",
  supports(modelId) {
    return modelId.length > 0;
  },
  createModel(_modelId, ctx) {
    void ctx.fetch;
    void ctx.signal;
    void ctx.logger;
    void ctx.options;
    return {
      complete: async () => ({
        events: (async function* () {})()
      })
    } satisfies AcpModel;
  }
};

type AssertAssignable<To, ignoredFrom extends To> = true;
type ignoredMcpServerConfigExtendsSpawnServer = AssertAssignable<McpSpawnServer, McpServerConfig>;
type ignoredMcpServerConfigCanBeBuiltFromSpawnServer = AssertAssignable<
  McpServerConfig,
  McpSpawnServer & { name: string }
>;

const plugin: AgentPlugin = {
  name: "example-plugin",
  tools: [tool],
  providers: [provider],
  prompt: async (ctx) => ({ ...ctx, metadata: { ...ctx.metadata, touched: true } }),
  hooks: {
    sessionStart(ctx) {
      void ctx;
      return hookDecisions[0];
    },
    userPromptSubmit(ctx) {
      void ctx;
      return inputDecisions[2];
    },
    preToolUse(ctx) {
      void ctx;
      return toolCallDecisions[3];
    },
    postToolUse(ctx) {
      void ctx;
      return toolResultDecisions[2];
    },
    preIteration(ctx) {
      void ctx.complete;
      void ctx.runHook;
      void ctx;
      return hookDecisions[0];
    },
    async postIteration(ctx) {
      const fork = await ctx.fork("quick check");
      const completion = await ctx.complete([{ role: "user", content: "quick check" }]);
      const notification = await ctx.runHook("notification", notificationContext);
      void completion;
      void notification;
      void fork;
      return hookDecisions[2];
    },
    preCompaction(ctx) {
      void ctx;
      return hookDecisions[1];
    },
    postCompaction(ctx) {
      void ctx;
      return hookDecisions[0];
    },
    notification(ctx) {
      void ctx;
      return hookDecisions[1];
    },
    stop(ctx) {
      void ctx;
      return hookDecisions[0];
    }
  },
  async setup(api) {
    api.addTool(tool);
    api.addMcp(mcpConfig);
  },
  async dispose() {}
};

void promptContext;
void plugin;
void toolUseContext.session;
void toolUseContext;
void iterationContext;
void sessionStartContext;
void userPromptSubmitContext;
void preCompactionContext;
void postCompactionContext;
void notificationContext;
void stopContext;
void pluginApi;
void providerContext;
void logger;
