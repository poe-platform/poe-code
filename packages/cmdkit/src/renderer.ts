import type { Command, RenderPrimitives } from "./index.js";

export type OutputMode = "rich" | "md" | "json";

type WriteFn = (chunk: string) => void;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isArrayOfObjects(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every((entry) => isObject(entry));
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

function renderObjectTable(result: Record<string, unknown>, primitives: RenderPrimitives): string {
  const rows = Object.entries(result).map(([key, value]) => ({
    key,
    value: stringifyValue(value),
  }));

  return primitives.renderTable({
    theme: primitives.getTheme(),
    columns: [
      {
        name: "key",
        title: "Key",
        alignment: "left",
        maxLen: Math.max("Key".length, ...rows.map((row) => row.key.length)),
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

function renderArrayTable(result: Array<Record<string, unknown>>, primitives: RenderPrimitives): string {
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
        ...result.map((row) => (name in row ? stringifyValue(row[name]).length : 0))
      ),
    })),
    rows: result.map((row) =>
      Object.fromEntries(
        columnNames.map((name) => [name, name in row ? stringifyValue(row[name]) : ""])
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
        .map((name) => (name in row ? stringifyValue(row[name]).replaceAll("|", "\\|") : ""))
        .join(" | ")} |`
  );

  return [header, separator, ...rows].join("\n");
}

function autoRender(result: unknown, output: OutputMode, primitives: RenderPrimitives): string {
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

  if (isObject(result)) {
    if (output === "rich") {
      return renderObjectTable(result, primitives);
    }

    if (output === "md") {
      return renderObjectMarkdown(result);
    }

    return stringifyJson(result, 2);
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

  return stringifyJson(result, 2);
}

export function renderResult(
  command: Command<any, any, any, any>,
  result: unknown,
  output: OutputMode,
  primitives: RenderPrimitives,
  write: WriteFn = (chunk) => {
    process.stdout.write(chunk);
  }
): void {
  if (output === "json" && command.render?.json) {
    const payload = command.render.json(result, primitives);
    if (payload !== undefined) {
      write(`${stringifyJson(payload, 2)}\n`);
    }
    return;
  }

  if (output === "md" && command.render?.markdown) {
    const payload = command.render.markdown(result, primitives);
    if (typeof payload === "string" && payload.length > 0) {
      write(`${payload}\n`);
    }
    return;
  }

  if (output === "rich" && command.render?.rich) {
    command.render.rich(result, primitives);
    return;
  }

  const payload = autoRender(result, output, primitives);
  if (payload.length > 0) {
    write(`${payload}\n`);
  }
}
