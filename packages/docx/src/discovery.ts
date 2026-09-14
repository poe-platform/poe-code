import metadata from "../package.json" with { type: "json" };
import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { DocumentBudget } from "./budget.js";
import { docxInvocationBudgets, validateDocxInvocation, type DocxInvocation } from "./command.js";
import { docxCommonOptions, docxOperationSchemas, type DocxOperationSchema } from "./operation-schema.js";
import { getDocxOperationSchema, type DocxJsonSchema } from "./operation-json-schema.js";
import { discoveryFailureSchema } from "./discovery-result-schema.js";

export interface DocxHelpData {
  readonly name: "docx";
  readonly paths: readonly { readonly path: readonly string[]; readonly usage: string; readonly description: string; readonly operationIds: readonly string[] }[];
}
export interface DocxSchemaData {
  readonly schemaVersion: 1;
  readonly operations: readonly { readonly id: string; readonly path: readonly string[]; readonly input: DocxJsonSchema;
    readonly result: DocxJsonSchema; readonly featureIds: readonly string[]; readonly support: "read" | "reject" }[];
}
export interface DocxCapabilitiesData {
  readonly features: readonly never[];
  readonly host: { readonly read: false; readonly atomicReplace: false; readonly transactions: false; readonly binaryStdout: true };
  readonly limits: readonly { readonly name: string; readonly ceiling: number }[];
}
export interface DocxVersionData { readonly name: "docx"; readonly version: string; readonly schemaVersion: 1 }
export interface DocxDiscovery {
  readonly data: DocxHelpData | DocxSchemaData | DocxCapabilitiesData | DocxVersionData;
  readonly human: string;
}

function commandPath(id: string, declaration: DocxOperationSchema): string[] {
  return declaration.transport === "typed-batch" ? ["batch"] : id.split(".");
}
function usage(id: string, declaration: DocxOperationSchema): string {
  const path = commandPath(id, declaration).join(" ");
  const input = declaration.transport === "typed-batch" ? " INPUT" :
    declaration.profile === "discovery" && Object.hasOwn(declaration.fields, "operation") ? " [COMMAND PATH]" :
    declaration.inputArity === "0|1" ? " [INPUT]" : declaration.inputArity === 2 ? " LEFT RIGHT" : declaration.inputArity === 1 ? " INPUT" : "";
  return `docx ${path}${input} [OPTIONS]`;
}
function description(declaration: DocxOperationSchema): string {
  return declaration.discovery?.description ?? "Declared contract; document operation not implemented by this engine.";
}
function details(id: string, declaration: DocxOperationSchema): string {
  const lines = [usage(id, declaration), "", description(declaration)];
  if (declaration.transport === "typed-batch") {
    lines.push("", `Batch operation: ${id}`, `Receiver: ${declaration.receiver ?? "none"}`, "Arguments:");
    for (const [key, field] of Object.entries(declaration.batchFields ?? {})) lines.push(`  ${key}: ${field.type}${field.required ? " (required)" : ""}`);
  } else {
    lines.push("", "Options:");
    const fields = { ...Object.fromEntries(declaration.commonOptions.map(key => [key, docxCommonOptions[key]!])), ...declaration.fields };
    for (const [key, field] of Object.entries(fields)) {
      const flag = [...key].map(c => c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c).join("");
      lines.push(`  --${flag}${key === "output" ? ", -o" : ""}  ${field.type}${field.required ? " (required)" : ""}`);
    }
    lines.push("  --help, -h  Show help without acquiring input.");
    if (Object.hasOwn(fields, "occurrence") && Object.hasOwn(fields, "first")) lines.push("", "Choose exactly one: --first | --all | --occurrence NUMBER.");
    if (Object.hasOwn(fields, "output") && Object.hasOwn(fields, "inPlace")) lines.push("", "Publication: --output PATH | --in-place | --dry-run.");
    if (Object.hasOwn(fields, "scope")) lines.push("", "Scope defaults to body; positions are one-based within their owner.");
    if (Object.hasOwn(fields, "select")) lines.push("Use either --select TOKEN or simple selectors; do not combine them.");
  }
  return lines.map(escapeTerminalText).join("\n") + "\n";
}

/** Read-only discovery over the maintained grammar; never acquires document inputs. */
export function getDocxDiscovery(invocation: DocxInvocation, budget = new DocumentBudget()): DocxDiscovery | undefined {
  const parsedBudget = docxInvocationBudgets.get(invocation);
  if (parsedBudget) budget = budget.lower(Object.fromEntries(Object.entries(budget.limits)
    .map(([name, ceiling]) => [name, Math.min(ceiling, parsedBudget.limits[name as keyof typeof parsedBudget.limits])])), parsedBudget.signal);
  invocation = validateDocxInvocation(invocation, budget);
  if (!docxOperationSchemas[invocation.operation]?.discovery || invocation.inputs.length) return undefined;
  if (invocation.options.limit !== undefined) budget = budget.lower(Object.fromEntries(
    (invocation.options.limit as readonly { name: string; value: number }[]).map(item => [item.name, item.value])
  ));
  const bounded = (discovery: DocxDiscovery): DocxDiscovery => {
    const wire = invocation.options.json === true || invocation.operation === "schema" ?
      JSON.stringify({ version: 1, operation: invocation.operation, ok: true, data: discovery.data, warnings: [], errors: [], affected: 0, locations: [] }) + "\n" : discovery.human;
    const bytes = new TextEncoder().encode(wire).byteLength;
    budget.check("serializedOutput", bytes);
    budget.charge("retainedBytes", bytes);
    return discovery;
  };
  if (invocation.operation === "version") return bounded({
    data: { name: "docx", version: metadata.version, schemaVersion: 1 }, human: `docx ${escapeTerminalText(metadata.version)}\n`
  });
  if (invocation.operation === "capabilities") {
    const limits = Object.entries(budget.limits).map(([name, ceiling]) => ({ name, ceiling }));
    return bounded({ data: { features: [], host: { read: false, atomicReplace: false, transactions: false, binaryStdout: true }, limits },
      human: "docx capabilities\n\nNo document feature operations are implemented by this engine.\nDocument-specific capabilities require an injected handler.\n\nLimits:\n" + limits.map(item => `  ${item.name}: ${item.ceiling}`).join("\n") + "\n" });
  }
  const selected = invocation.options.operation as string | undefined;
  const declarations = selected ? [[selected, docxOperationSchemas[selected]!] as const] :
    Object.entries(docxOperationSchemas).filter(([, declaration]) => declaration.discovery !== undefined);
  if (invocation.operation === "help") {
    const data: DocxHelpData = { name: "docx", paths: declarations.map(([id, declaration]) => ({
      path: commandPath(id, declaration), usage: usage(id, declaration), description: description(declaration), operationIds: [id]
    })) };
    return bounded({ data, human: selected ? details(selected, declarations[0]![1]) :
      "docx — document utility\n\nImplemented commands:\n" + data.paths.map(item => `  ${item.usage}\n    ${item.description}`).join("\n") +
      "\n\nUse docx help COMMAND PATH for a declared contract.\nDocument feature operations remain unavailable in this engine.\nAliases: --help, -h; --version.\n" });
  }
  const data: DocxSchemaData = { schemaVersion: 1, operations: declarations.map(([id, declaration]) => ({
    id, path: commandPath(id, declaration), input: getDocxOperationSchema(id, declaration.transport === "typed-batch" ? "batch" : "sdk"),
    result: declaration.discovery?.result ?? { ...discoveryFailureSchema(id), description: "Only failures are specified here; operation not implemented." },
    featureIds: declaration.discovery?.featureIds ?? [], support: declaration.discovery ? "read" : "reject"
  })) };
  return bounded({ data, human: JSON.stringify(data) + "\n" });
}
