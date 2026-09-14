import metadata from "../package.json" with { type: "json" };
import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { documentValidationProfile } from "./validation.js";
import { DocumentBudget } from "./budget.js";
import { docxInvocationBudgets, validateDocxInvocation, type DocxInvocation } from "./command.js";
import { docxCommonOptions, docxOperationSchemas, type DocxOperationSchema } from "./operation-schema.js";
import { getDocxOperationSchema, type DocxJsonSchema } from "./operation-json-schema.js";
import { discoveryFailureSchema, inspectionOperationMetadata } from "./discovery-result-schema.js";

export interface DocxHelpData {
  readonly name: "docx";
  readonly paths: readonly { readonly path: readonly string[]; readonly usage: string; readonly description: string; readonly operationIds: readonly string[] }[];
}
export interface DocxSchemaData {
  readonly schemaVersion: 1;
  readonly validationProfiles: readonly (typeof documentValidationProfile)[];
  readonly operations: readonly { readonly id: string; readonly path: readonly string[]; readonly input: DocxJsonSchema;
    readonly result: DocxJsonSchema; readonly featureIds: readonly string[]; readonly support: "read" | "edit" | "reject" }[];
}
export interface DocxCapabilitiesData {
  readonly features: readonly { readonly id: string; readonly level: "read" | "edit"; readonly subsets: readonly { readonly name: string; readonly level: "read" | "edit"; readonly reason: string }[]; readonly detected: null }[];
  readonly host: { readonly read: false; readonly atomicReplace: false; readonly transactions: false; readonly binaryStdout: true };
  readonly limits: readonly { readonly name: string; readonly ceiling: number }[];
  readonly validationProfiles: readonly (typeof documentValidationProfile)[];
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
  const id = Object.keys(docxOperationSchemas).find(key => docxOperationSchemas[key] === declaration)!;
  return inspectionOperationMetadata[id]?.description ?? declaration.discovery?.description ?? "Declared contract; document operation not implemented by this engine.";
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
    if (id === "create") lines.push("", "Content: version 1 blocks; optional page, styles and theme settings for new packages.", "Defaults: DOCX, Transitional, US Letter portrait, one-inch margins and Normal style.", "Template blocks append before final section properties; kind/dialect and existing settings are retained.", "No executable templates, field evaluation, font discovery or automatic timestamps.");
    if (id === "xml.get") lines.push("", "Select one absolute OPC name with --part; no basename or wildcard matching.",
      "--raw is byte-exact, including BOM and encoding. Default JSON uses base64.",
      "--pretty is UTF-8 display serialization, not byte-exact XML; existing text whitespace is retained.");
    if (id === "xml.set") lines.push("", "--file supplies a complete XML document, never a fragment or expression.",
      "Root expanded name, document kind/dialect and package references must remain valid.",
      "Opaque content must retain its structural position and namespace context; protected/signed inputs reject.");
    if (id === "text.get") lines.push("", "Alias: docx text INPUT [OPTIONS]. View defaults to final.",
      "Hidden text is included; formatting is direct context, without style resolution.",
      "Field instructions and drawing/equation text are omitted.",
      "Order: body, headers, footers, footnotes, endnotes, comments, text boxes.",
      "Shared parts appear once. Notes/comments: canonical part, then numeric ID.",
      "Paragraph/row: LF; cell/tab: TAB; story: two LFs; page: FF; column: VT.",
      "Cached page breaks add nothing. No extra trailing separator is appended.");
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
    return bounded({ data: { features: [{ id: "F12", level: "edit", subsets: [{ name: "scoped-direct-run-formatting", level: "edit", reason: "Run or paragraph scalar ranges; nullable direct properties, explicit font/theme references and half-point sizes. No style resolution, font loading, whole-text assignment or model batch execution." }], detected: null }, { id: "F11", level: "edit", subsets: [{ name: "structured-creation", level: "edit", reason: "DOCX/DOTX, Strict/Transitional; original paragraphs/tables and explicit new-package settings; append-only supplied templates." }], detected: null }, { id: "F06", level: "read", subsets: [{ name: "inventory", level: "read", reason: "No rendering, linked-resource access or signature verification." }], detected: null }, { id: "F49", level: "read", subsets: [{ name: "core-v1", level: "read", reason: "Partial core-v1 validation only." }], detected: null }, { id: "F08", level: "read", subsets: [{ name: "logical-story-text", level: "read", reason: "Explicit story scopes and review views; hidden text included, cached field results only; no drawing/equation text or rendering." }], detected: null }, { id: "F09", level: "read", subsets: [{ name: "logical-unicode", level: "read", reason: "Unicode order and direct language/RTL/font properties; no shaping or style cascade." }], detected: null }, { id: "F07", level: "edit", subsets: [{ name: "explicit-xml-part", level: "edit", reason: "Validated whole-part replacement; immutable opaque content, no protection bypass; raw bytes or bounded display serialization." }], detected: null }, { id: "F10", level: "edit", subsets: [{ name: "literal-paragraph-text", level: "edit", reason: "Nonoverlapping original-text matches, run formatting preservation, explicit cardinality and bold/italic overrides; structural barriers, protected and shared parts guarded." }], detected: null }], host: { read: false, atomicReplace: false, transactions: false, binaryStdout: true }, limits, validationProfiles: [documentValidationProfile] },
      human: "docx capabilities\n\nInspection and partial core-v1 validation are implemented.\nDocument reads require explicit filesystem or stdin authority.\n\nLimits:\n" + limits.map(item => `  ${item.name}: ${item.ceiling}`).join("\n") + "\n" });
  }
  const selected = invocation.options.operation as string | undefined;
  const declarations = selected ? [[selected, docxOperationSchemas[selected]!] as const] :
    Object.entries(docxOperationSchemas).filter(([id, declaration]) => declaration.discovery !== undefined || inspectionOperationMetadata[id] !== undefined);
  if (invocation.operation === "help") {
    const data: DocxHelpData = { name: "docx", paths: declarations.map(([id, declaration]) => ({
      path: commandPath(id, declaration), usage: usage(id, declaration), description: description(declaration), operationIds: [id]
    })) };
    return bounded({ data, human: selected ? details(selected, declarations[0]![1]) :
      "docx — document utility\n\nImplemented commands:\n" + data.paths.map(item => `  ${item.usage}\n    ${item.description}`).join("\n") +
      "\n\nUse docx help COMMAND PATH for a declared contract.\nInspection, validation and text extraction are read-only. Text replace preserves run formatting; XML set replaces one validated part. Later document operations remain pending.\nAliases: --help, -h; --version.\n" });
  }
  const data: DocxSchemaData = { schemaVersion: 1, validationProfiles: [documentValidationProfile], operations: declarations.map(([id, declaration]) => ({
    id, path: commandPath(id, declaration), input: getDocxOperationSchema(id, declaration.transport === "typed-batch" ? "batch" : "sdk"),
    result: inspectionOperationMetadata[id]?.result ?? declaration.discovery?.result ?? { ...discoveryFailureSchema(id), description: "Only failures are specified here; operation not implemented." },
    featureIds: inspectionOperationMetadata[id]?.featureIds ?? declaration.discovery?.featureIds ?? [], support: ["xml.set", "create", "text.replace", "runs.set"].includes(id) ? "edit" : declaration.discovery || inspectionOperationMetadata[id] ? "read" : "reject"
  })) };
  return bounded({ data, human: JSON.stringify(data) + "\n" });
}
