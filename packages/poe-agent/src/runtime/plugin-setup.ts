import { PluginSetupError, PromptTransformError } from "./errors.js";
import type { AgentPlugin } from "./plugin-types.js";
import { PluginApiImpl } from "./plugin-api-impl.js";
import type { RunContext } from "./run-context.js";

export async function runPluginSetup(plugins: AgentPlugin[], runContext: RunContext): Promise<void> {
  for (const plugin of plugins) {
    const api = new PluginApiImpl(runContext);
    let setupError: unknown;

    try {
      for (const tool of plugin.tools ?? []) {
        runContext.tools.register(tool);
      }

      if (plugin.prompt) {
        runContext.prompts.addTransform(async ctx => {
          try {
            return await plugin.prompt!(ctx);
          } catch (error) {
            throw new PromptTransformError(plugin.name, error);
          }
        });
      }

      runContext.hooks.add(plugin);

      if (plugin.setup) {
        await plugin.setup(api);
      }

      await api.flushSetup();

      if (plugin.dispose) {
        runContext.registerDisposeHook(async () => {
          await plugin.dispose!();
        });
      }
    } catch (error) {
      setupError = error;
    }

    if (setupError === undefined) {
      continue;
    }

    const finalSetupError = await settleMcpSetupError(api, setupError);

    try {
      await runContext.dispose();
    } catch (disposeError) {
      throw new PluginSetupError(
        plugin.name,
        new AggregateError(
          [finalSetupError, disposeError],
          `Plugin setup/disposal failed for "${plugin.name}".`,
        ),
      );
    }

    throw new PluginSetupError(plugin.name, finalSetupError);
  }
}

async function settleMcpSetupError(api: PluginApiImpl, setupError: unknown): Promise<unknown> {
  try {
    await api.flushSetup();
    return setupError;
  } catch (mcpSetupError) {
    if (mcpSetupError === setupError) {
      return setupError;
    }

    return new AggregateError(
      [setupError, mcpSetupError],
      "Plugin setup and MCP discovery both failed.",
    );
  }
}
