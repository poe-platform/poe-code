import type { OpBackendContext, OpObject } from "./types.js";
import { availablePlugins } from "./plugin-catalog.js";

export async function selectPluginId(plugins: readonly OpObject[], context: OpBackendContext, accountId: string | null): Promise<string> {
  const { signal, selectPlugin } = context;
  signal.throwIfAborted();
  if (!selectPlugin) throw new Error("Plugin selection capability is unavailable");
  const candidates = Object.freeze(availablePlugins(plugins).flatMap(plugin => {
    const id = plugin.executable ?? plugin.id;
    return id === undefined ? [] : [Object.freeze({ id, name: plugin.plugin_name ?? plugin.name ?? id })];
  }));
  let abort!: () => void;
  let selected: unknown;
  try {
    selected = await Promise.race([
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(new Error("Plugin selection cancelled"));
        signal.addEventListener("abort", abort, { once: true });
      }),
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return selectPlugin(candidates, Object.freeze({ signal, accountId }));
      })
    ]);
    signal.throwIfAborted();
  } catch {
    signal.throwIfAborted();
    throw new Error("Plugin selection failed");
  } finally { signal.removeEventListener("abort", abort); }
  if (selected === undefined) throw new Error("Plugin selection cancelled");
  if (typeof selected !== "string" || !candidates.some(candidate => candidate.id === selected)) throw new Error("Invalid plugin selection");
  const configured = plugins.find(plugin => plugin.id.toLowerCase() === selected.toLowerCase());
  if (!configured) throw new Error("Plugin configuration is unavailable");
  return configured.id;
}
