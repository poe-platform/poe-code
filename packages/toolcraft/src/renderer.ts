import YAML from "yaml";
import { renderDetailCard } from "toolcraft-design";
import type { Command, RenderPrimitives } from "./index.js";

export type OutputMode = "rich" | "md" | "json";

type WriteStream = "stdout" | "stderr";
type WriteFn = (chunk: string, stream?: WriteStream) => void;

export interface RenderResultStatus {
  mcpError: boolean;
}

interface McpCallToolResult {
  content?: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: unknown;
}

interface McpTextContent {
  type: "text";
  text: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMcpCallToolResult(value: unknown): value is McpCallToolResult {
  if (!isObject(value)) {
    return false;
  }

  const hasContent = Array.isArray(value.content);
  const hasStructured = value.structuredContent !== undefined;
  if (!hasContent && !hasStructured) {
    return false;
  }

  return Object.keys(value).every(
    (key) =>
      key === "content" || key === "structuredContent" || key === "isError" || key === "_meta"
  );
}

function isMcpTextContent(value: unknown): value is McpTextContent {
  return isObject(value) && value.type === "text" && typeof value.text === "string";
}

function extractMcpPayload(envelope: McpCallToolResult): unknown {
  const structuredContent = envelope.structuredContent;
  if (isObject(structuredContent) && "result" in structuredContent) {
    return structuredContent.result;
  }

  if (structuredContent !== undefined) {
    return structuredContent;
  }

  if (Array.isArray(envelope.content)) {
    const text = envelope.content
      .filter(isMcpTextContent)
      .map((block) => block.text)
      .join("\n");

    return text.length > 0 ? text : undefined;
  }

  return undefined;
}

function unwrapMcpEnvelope(result: unknown): { result: unknown; mcpError: boolean } {
  if (!isMcpCallToolResult(result)) {
    return { result, mcpError: false };
  }

  return {
    result: extractMcpPayload(result),
    mcpError: result.isError === true,
  };
}

function isArrayOfObjects(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every((entry) => isObject(entry));
}

function isNonEmptyArrayOfObjects(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => isObject(entry));
}

function stringifyValue(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return stringifyJson(value);
}

function stringifyJson(value: unknown, spaces?: number): string {
  try {
    return JSON.stringify(
      value,
      (_key, currentValue) => (typeof currentValue === "bigint" ? currentValue.toString() : currentValue),
      spaces
    ) ?? String(value);
  } catch {
    return String(value);
  }
}

function humanizeKey(key: string): string {
  let output = "";
  let capitalizeNext = true;

  for (const char of key) {
    if (char === "_" || char === "-") {
      output += " ";
      capitalizeNext = false;
      continue;
    }

    if (char >= "A" && char <= "Z" && output.length > 0 && !output.endsWith(" ")) {
      output += " ";
    }

    if (capitalizeNext) {
      output += char.toUpperCase();
      capitalizeNext = false;
      continue;
    }

    output += char;
  }

  return output;
}

function detailRows(
  result: Record<string, unknown>,
  depth = 0
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];

  for (const [key, value] of Object.entries(result)) {
    const label = `${"  ".repeat(depth)}${humanizeKey(key)}`;

    if (isObject(value)) {
      if (Object.keys(value).length === 0) {
        rows.push({ label, value: "{}" });
        continue;
      }

      rows.push({ label, value: "" });
      rows.push(...detailRows(value, depth + 1));
      continue;
    }

    if (isNonEmptyArrayOfObjects(value)) {
      rows.push({ label, value: "" });
      rows.push(...arrayObjectDetailRows(value, depth + 1));
      continue;
    }

    rows.push({ label, value: displayScalar(value) });
  }

  return rows;
}

function arrayObjectDetailRows(
  value: Array<Record<string, unknown>>,
  depth: number
): Array<{ label: string; value: string }> {
  return value.flatMap((entry, index) => {
    if (value.length === 1) {
      return detailRows(entry, depth);
    }

    return [
      { label: `${"  ".repeat(depth)}${index + 1}`, value: "" },
      ...detailRows(entry, depth + 1)
    ];
  });
}

function displayScalar(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (Array.isArray(value) && value.every((entry) => !isObject(entry) && !Array.isArray(entry))) {
    return value.map((entry) => displayScalar(entry)).join(", ") || "—";
  }
  return stringifyValue(value) || "—";
}

function isUrl(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("https://") || value.startsWith("http://"));
}

function compactUrl(value: string): string {
  try {
    const url = new URL(value);
    const tail = url.pathname.split("/").filter(Boolean).at(-1);
    return tail ? `${url.hostname}/…/${tail}` : url.hostname;
  } catch {
    return value;
  }
}

function displayRowValue(value: unknown): string {
  return isUrl(value) ? compactUrl(value) : displayScalar(value);
}

function directScalarRows(result: Record<string, unknown>): Array<{ label: string; value: string }> {
  return Object.entries(result)
    .filter(([, value]) => !isObject(value) && !Array.isArray(value))
    .map(([key, value]) => ({ label: humanizeKey(key), value: displayRowValue(value) }));
}

function directObjectSections(result: Record<string, unknown>): Array<{ title: string; rows: Array<{ label: string; value: string }> }> {
  return Object.entries(result)
    .filter(([, value]) => isObject(value))
    .map(([key, value]) => ({ title: humanizeKey(key), rows: detailRows(value as Record<string, unknown>) }))
    .filter((section) => section.rows.length > 0);
}

function directArrayObjectSections(
  result: Record<string, unknown>
): Array<{ title: string; rows: Array<{ label: string; value: string }> }> {
  return Object.entries(result).flatMap(([key, value]) => {
    if (!isNonEmptyArrayOfObjects(value)) {
      return [];
    }

    const title = humanizeKey(key);
    return value
      .map((entry, index) => ({
        title: value.length === 1 ? title : `${title} ${index + 1}`,
        rows: detailRows(entry)
      }))
      .filter((section) => section.rows.length > 0);
  });
}

function renderObjectCard(
  result: Record<string, unknown>,
  primitives: RenderPrimitives,
  title: string
): string {
  const scalarRows = directScalarRows(result);
  const nestedSections = directObjectSections(result);
  const arrayObjectSections = directArrayObjectSections(result);
  const listRows = Object.entries(result)
    .filter(([, value]) => Array.isArray(value) && !isNonEmptyArrayOfObjects(value))
    .map(([key, value]) => ({ label: humanizeKey(key), value: displayScalar(value) }));

  return renderDetailCard({
    theme: primitives.getTheme(),
    title,
    sections: [
      { rows: scalarRows },
      ...nestedSections,
      { title: "Lists", rows: listRows },
      ...arrayObjectSections
    ]
  });
}

function richResultTitle(command: Command<any, any, any, any>): string {
  const description = command.description?.trim();
  if (description && !description.includes("\n") && description.length <= 64) {
    return description;
  }
  return command.name ? humanizeKey(command.name) : "Result";
}

export function renderObjectTable(result: Record<string, unknown>, primitives: RenderPrimitives): string {
  const rows = detailRows(result);
  if (rows.length === 0) {
    return "{}";
  }

  return primitives.renderTable({
    theme: primitives.getTheme(),
    variant: "detail",
    columns: [
      {
        name: "label",
        title: "Label",
        alignment: "left",
        maxLen: Math.max("Label".length, ...rows.map((row) => row.label.length)),
      },
      {
        name: "value",
        title: "Value",
        alignment: "left",
        maxLen: Math.max("Value".length, ...rows.map((row) => row.value.length)),
      },
    ],
    rows,
  });
}

function renderObjectMarkdown(result: Record<string, unknown>): string {
  return Object.entries(result)
    .map(([key, value]) => `- ${key}: ${stringifyValue(value)}`)
    .join("\n");
}

function getColumnNames(rows: Array<Record<string, unknown>>): string[] {
  const names = new Set<string>();

  for (const row of rows) {
    for (const name of Object.keys(row)) {
      names.add(name);
    }
  }

  return [...names];
}

export function renderArrayTable(result: Array<Record<string, unknown>>, primitives: RenderPrimitives): string {
  if (result.length === 0) {
    return "[]";
  }

  const columnNames = getColumnNames(result);

  return primitives.renderTable({
    theme: primitives.getTheme(),
    columns: columnNames.map((name) => ({
      name,
      title: name,
      alignment: "left",
      maxLen: Math.max(
        name.length,
        ...result.map((row) =>
          Object.prototype.hasOwnProperty.call(row, name) ? stringifyValue(row[name]).length : 0
        )
      ),
    })),
    rows: result.map((row) =>
      Object.fromEntries(
        columnNames.map((name) => [
          name,
          Object.prototype.hasOwnProperty.call(row, name) ? stringifyValue(row[name]) : ""
        ])
      )
    ),
  });
}

function renderArrayMarkdown(result: Array<Record<string, unknown>>): string {
  if (result.length === 0) {
    return "[]";
  }

  const columnNames = getColumnNames(result);
  const header = `| ${columnNames.join(" | ")} |`;
  const separator = `| ${columnNames.map(() => ":---").join(" | ")} |`;
  const rows = result.map(
    (row) =>
      `| ${columnNames
        .map((name) =>
          Object.prototype.hasOwnProperty.call(row, name)
            ? stringifyValue(row[name]).replaceAll("|", "\\|")
            : ""
        )
        .join(" | ")} |`
  );

  return [header, separator, ...rows].join("\n");
}

function autoRender(
  command: Command<any, any, any, any>,
  result: unknown,
  output: OutputMode,
  primitives: RenderPrimitives
): string {
  if (result === null || result === undefined) {
    if (output === "json") {
      return stringifyJson({ ok: true }, 2);
    }

    return "Done.";
  }

  if (typeof result === "string") {
    if (output === "json") {
      return stringifyJson({ result }, 2);
    }

    return result;
  }

  if (output === "rich" && Array.isArray(result) && result.every((value) => typeof value === "string")) {
    return result.join("\n");
  }

  if (isObject(result)) {
    if (output === "md") {
      return renderObjectMarkdown(result);
    }

    if (output === "json") {
      return stringifyJson(result, 2);
    }

    return renderObjectCard(result, primitives, richResultTitle(command));
  }

  if (isArrayOfObjects(result)) {
    if (output === "md") {
      return renderArrayMarkdown(result);
    }

    if (output === "json") {
      return stringifyJson(result, 2);
    }

    return renderArrayTable(result, primitives);
  }

  if (output === "rich") {
    return YAML.stringify(result);
  }

  return stringifyJson(result, 2);
}

export function renderResult(
  command: Command<any, any, any, any>,
  result: unknown,
  output: OutputMode,
  primitives: RenderPrimitives,
  write: WriteFn = (chunk, stream = "stdout") => {
    if (stream === "stderr") {
      process.stderr.write(chunk);
      return;
    }

    process.stdout.write(chunk);
  }
): RenderResultStatus {
  const unwrapped = unwrapMcpEnvelope(result);
  result = unwrapped.result;

  if (unwrapped.mcpError) {
    const payload = autoRender(command, result, output, primitives);
    if (payload.length > 0) {
      write(`${payload}\n`, "stderr");
    }
    return { mcpError: true };
  }

  if (output === "json" && command.render?.json) {
    const payload = command.render.json(result, primitives);
    if (payload !== undefined) {
      write(`${stringifyJson(payload, 2)}\n`);
    }
    return { mcpError: false };
  }

  if (output === "md" && command.render?.markdown) {
    const payload = command.render.markdown(result, primitives);
    if (typeof payload === "string" && payload.length > 0) {
      write(`${payload}\n`);
    }
    return { mcpError: false };
  }

  if (output === "rich" && command.render?.rich) {
    command.render.rich(result, primitives);
    return { mcpError: false };
  }

  const payload = autoRender(command, result, output, primitives);
  if (payload.length > 0) {
    write(`${payload}\n`);
  }
  return { mcpError: false };
}
