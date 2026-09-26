import { pluginRequiredFieldLabels } from "./plugin-catalog.js";

export function renderPluginList(plugins: readonly Record<string, unknown>[]): string {
  if (!plugins.length) return "";
  const rows = [["EXECUTABLE", "NAME", "REQUIRED FIELDS"], ...plugins.map(plugin => {
    const executable = typeof plugin.executable === "string" ? plugin.executable : typeof plugin.id === "string" ? plugin.id : "-";
    const name = typeof plugin.plugin_name === "string" ? plugin.plugin_name : typeof plugin.name === "string" ? plugin.name : executable;
    const key = typeof plugin.executable === "string" ? plugin.executable : typeof plugin.plugin_name === "string" ? plugin.plugin_name : "";
    const requiredFields = plugin.source === "1password-registry" && Object.hasOwn(pluginRequiredFieldLabels, key) ? pluginRequiredFieldLabels[key]! : "-";
    return [executable, name, requiredFields];
  })];
  const executableWidth = Math.max(...rows.map(row => row[0]!.length)) + 4;
  const nameWidth = Math.max(...rows.map(row => row[1]!.length)) + 4;
  return rows.map(row => `${row[0]!.padEnd(executableWidth)}${row[1]!.padEnd(nameWidth)}${row[2]}`).join("\n") + "\n";
}
