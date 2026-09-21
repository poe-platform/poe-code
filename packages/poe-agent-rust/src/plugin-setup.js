import { createRequire } from "node:module";
import { PluginSetupError, PromptTransformError } from "./errors.js";
import { PluginApiImpl } from "./plugin-api.js";
import { assertValidToolName } from "./tool-names.js";
const native = createRequire(import.meta.url)("./poe-agent-rust.node");

export async function runPluginSetup(plugins, runContext) {
  for (const plugin of plugins) {
    const contributor = `plugin: ${plugin.name}`;
    const api = new PluginApiImpl(runContext, contributor);
    const plan = new native.NativeAgentSetupPlan();
    let effect;
    try {
      while ((effect = plan.next(1)) !== null) {
        switch (effect.stage) {
          case "tools":
            for (const tool of plugin.tools ?? []) {
              assertValidToolName(tool.name, contributor);
              runContext.tools.register(tool);
            }
            break;
          case "prompt":
            if (plugin.prompt)
              runContext.prompts.addTransform(async (context) => {
                try {
                  return await plugin.prompt(context);
                } catch (error) {
                  throw new PromptTransformError(plugin.name, error);
                }
              });
            break;
          case "hooks":
            runContext.hooks.add(plugin);
            break;
          case "setup":
            if (plugin.setup) await plugin.setup(api);
            break;
          case "flush":
            await api.flushSetup();
            break;
          case "dispose":
            if (plugin.dispose)
              runContext.registerDisposeHook(async () => {
                await plugin.dispose();
              });
            break;
        }
      }
    } catch (setupError) {
      if (setupError === undefined) continue;
      let finalSetupError = setupError;
      try {
        await api.flushSetup();
      } catch (mcpSetupError) {
        if (mcpSetupError !== setupError)
          finalSetupError = new AggregateError(
            [setupError, mcpSetupError],
            "Plugin setup and MCP discovery both failed."
          );
      }
      try {
        await runContext.dispose();
      } catch (disposeError) {
        throw new PluginSetupError(
          plugin.name,
          new AggregateError(
            [finalSetupError, disposeError],
            `Plugin setup/disposal failed for "${plugin.name}".`
          )
        );
      }
      throw new PluginSetupError(plugin.name, finalSetupError);
    }
  }
}
