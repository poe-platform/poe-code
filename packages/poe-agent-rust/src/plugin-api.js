import { createRequire } from "node:module";
import { McpClient, StdioTransport } from "./client/index.js";
import { AbortError } from "./hooks.js";
import { cloneMcpServerConfig } from "./config.js";
import { toolResultPartToText } from "./tool-results.js";
import { assertValidToolName } from "./tool-names.js";
const native = createRequire(import.meta.url)("./poe-agent-rust.node");

export class PluginApiImpl {
  #runContext;
  #pluginName;
  #setupQueue = Promise.resolve();
  constructor(runContext, pluginName) {
    this.#runContext = runContext;
    this.#pluginName = pluginName;
  }
  addTool(tool) {
    assertValidToolName(tool.name, this.#pluginName);
    this.#runContext.tools.register(tool);
  }
  getTool(name) {
    return this.#runContext.tools.get(name);
  }
  addMcp(config) {
    const cloned = cloneMcpServerConfig(config);
    this.#runContext.mcpServers.push(cloned);
    this.#setupQueue = this.#setupQueue.then(() => this.#setupMcp(cloned));
  }
  async flushSetup() {
    await this.#setupQueue;
  }
  async #setupMcp(config) {
    const signal = this.#runContext.abortController.signal;
    if (signal.aborted) throw new AbortError("Run aborted.", signal.reason);
    const transport = new StdioTransport({
      command: config.command,
      args: config.args,
      env: config.env === undefined ? undefined : { ...process.env, ...config.env }
    });
    const client = new McpClient({
      clientInfo: { name: "poe-agent", version: "0.0.1" },
      ...(config.timeout === undefined ? {} : { requestTimeoutMs: config.timeout * 1000 })
    });
    this.#runContext.registerDisposeHook(async () => {
      await client.close?.();
    });
    const options = { signal };
    await client.connect(transport, options);
    const pages = new native.NativeAgentMcpPages(),
      handles = new Map();
    let cursor;
    const handle = (value) => {
      if (!handles.has(value)) handles.set(value, handles.size);
      return handles.get(value);
    };
    while (true) {
      if (signal.aborted) throw new AbortError("Run aborted.", signal.reason);
      const page = await client.listTools(cursor === undefined ? undefined : { cursor }, options);
      pages.advance();
      for (const tool of page.tools) this.addTool(this.#toRuntimeTool(config, tool, client));
      if (page.nextCursor === undefined) return;
      if (pages.seen(handle(page.nextCursor)))
        throw new Error(native.agentMcpDiscoveryError(`${config.name}`, true));
      if (pages.exceeded) throw new Error(native.agentMcpDiscoveryError(`${config.name}`, false));
      pages.record(handle(page.nextCursor));
      cursor = page.nextCursor;
    }
  }
  #toRuntimeTool(config, tool, client) {
    return {
      name: `${config.name}_${tool.name}`,
      description: tool.description,
      inputSchema: tool.inputSchema,
      visibility: config.visibility ?? "model",
      policy: { read: false, edit: true },
      call: async (args, context) => {
        const result = await client.callTool(
          {
            name: tool.name,
            arguments:
              typeof args === "object" && args !== null && !Array.isArray(args) ? args : undefined
          },
          { signal: context.signal }
        );
        const content = result.content.map((item) =>
          native.mapAgentMcpPart(
            item,
            (kind, value) =>
              kind === "audio"
                ? `[audio: ${value.mimeType}]`
                : kind === "blob"
                  ? `[blob: ${value.uri}]`
                  : `${value.title ?? value.name}: ${value.uri}`,
            (resource) => "text" in resource
          )
        );
        if (result.isError)
          return native.agentMcpToolError(content.map(toolResultPartToText).join("\n"));
        if (content.length === 0) return "";
        if (content.length === 1) {
          const [single] = content;
          return single.type === "text" ? single.text : single;
        }
        return content;
      }
    };
  }
}
