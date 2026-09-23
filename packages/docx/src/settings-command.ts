import { inspectDocumentSettings } from "./settings.js";
import { archiveSettings, type ArchiveContext } from "./archive.js";
import type { DocxInvocation } from "./command.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";

export async function executeSettingsCommand(invocation: DocxInvocation, bytes: Uint8Array, context: ArchiveContext): Promise<Uint8Array> {
  const settings = archiveSettings(context), budget = settings.budget.lower(Object.fromEntries((invocation.options.limit as readonly { name: string; value: number }[] | undefined ?? []).map(limit => [limit.name, limit.value])));
  const data = await inspectDocumentSettings(bytes, invocation.options as DocxOperationArguments<"settings.list">, { ...settings, budget }, "resource");
  const result = { version: 1, operation: "settings.list", ok: true, data, warnings: [], errors: [], affected: 0, locations: data.items.map(item => item.location) };
  measurePackageResourceSerialization(result, budget);
  const text = invocation.options.json ? JSON.stringify(result) + "\n" : `Settings parts: ${data.items.length}\n` + data.items.map(item => {
    const field = (name: string) => item.properties.find(property => property.name === name)?.value;
    return `${escapeTerminalText(item.name)}: ${item.support}; ${field("entryCount")} entries; ${field("opaqueCount")} opaque\n  Field updates: ${field("updateFields") ?? "absent or unsupported"}\n` +
      ["embedTrueTypeFonts", "embedSystemFonts", "saveSubsetFonts"].map(name => `  ${name}: ${field(name) ?? "absent or unsupported"}\n`).join("") +
      item.properties.filter(property => property.name.startsWith("protection[") && property.name.endsWith(".kind")).map(property => {
        const prefix = property.name.slice(0, -5);
        return `  ${escapeTerminalText(String(property.value))}: enforced ${field(prefix + ".enforced") ?? "unknown"}; edit ${escapeTerminalText(String(field(prefix + ".edit") ?? "unspecified"))}\n`;
      }).join("");
  }).join("");
  const output = new TextEncoder().encode(text);
  budget.check("serializedOutput", output.length); budget.charge("retainedBytes", output.length * 3);
  return output;
}
