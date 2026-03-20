import type {
  AgentPlugin,
  HookDecision,
  IterationContext,
  McpServerConfig,
  PluginApi,
  PromptContext,
  ToolUseContext,
} from "./plugin-types.js";
import type { Tool } from "./types.js";

declare const tool: Tool;
declare const toolUseContext: ToolUseContext;
declare const iterationContext: IterationContext;
declare const pluginApi: PluginApi;

const hookDecisions: HookDecision[] = [
  undefined,
  "skip",
  "abort",
  { reject: "missing permission" },
];

const promptContext: PromptContext = {
  userPrompt: "fix this bug",
};

const mcpConfig: McpServerConfig = {
  name: "repo-tools",
  command: "node",
  args: ["server.js"],
  env: { NODE_ENV: "test" },
  visibility: "skill",
};

const plugin: AgentPlugin = {
  name: "example-plugin",
  tools: [tool],
  prompt: async ctx => ({ ...ctx, metadata: { ...ctx.metadata, touched: true } }),
  hooks: {
    preToolUse(ctx) {
      void ctx;
      return hookDecisions[1];
    },
    postToolUse(ctx) {
      void ctx;
      return hookDecisions[3];
    },
    preIteration(ctx) {
      void ctx;
      return hookDecisions[0];
    },
    async postIteration(ctx) {
      const fork = await ctx.fork("quick check");
      void fork;
      return hookDecisions[2];
    },
  },
  async setup(api) {
    api.addTool(tool);
    api.addMcp(mcpConfig);
  },
  async dispose() {},
};

void promptContext;
void plugin;
void toolUseContext;
void iterationContext;
void pluginApi;
