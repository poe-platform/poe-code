import * as nodeFs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { toJsonSchema } from "toolcraft-schema";

import { extractSchema } from "../loader/extract-schema.js";

interface HarnessSchemaFileSystem {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  writeFile(
    filePath: string,
    data: string,
    options?: BufferEncoding | { encoding?: BufferEncoding }
  ): Promise<unknown>;
}

interface RunHarnessCodegenOptions {
  fs?: HarnessSchemaFileSystem;
  repoRoot?: string;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

const draft202012SchemaId = "https://json-schema.org/draft/2020-12/schema";
const publicHarnessSchemaBaseUrl = "https://poe-platform.github.io/poe-code/schemas/harnesses";

export async function runHarnessCodegen(
  options: RunHarnessCodegenOptions = {}
): Promise<void> {
  const fs = options.fs ?? nodeFs;
  const repoRoot = options.repoRoot ?? resolveRepoRoot();
  const outputDirectory = path.join(repoRoot, "docs", "schemas", "harnesses");

  await fs.mkdir(outputDirectory, { recursive: true });

  for (const template of await listBuiltinTemplateSchemaSources()) {
    const ajsSource = await nodeFs.readFile(template.ajsPath, "utf8");
    const schema = await extractSchema(ajsSource, template.ajsPath);

    if (schema === undefined) {
      throw new Error(`Built-in harness template ${template.kind} does not export a schema.`);
    }

    const fileName = `${template.kind}.schema.json`;
    const document = {
      $schema: draft202012SchemaId,
      $id: `${publicHarnessSchemaBaseUrl}/${fileName}`,
      ...toJsonSchema(schema)
    };

    await fs.writeFile(
      path.join(outputDirectory, fileName),
      serializeJsonDocument(document),
      "utf8"
    );
  }
}

function resolveRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

async function listBuiltinTemplateSchemaSources(): Promise<Array<{ ajsPath: string; kind: string }>> {
  const templateDirectory = fileURLToPath(new URL("../templates/", import.meta.url));
  const entries = await nodeFs.readdir(templateDirectory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      kind: entry.name,
      ajsPath: path.join(templateDirectory, entry.name, `${entry.name}.ajs`)
    }))
    .sort((left, right) => left.kind.localeCompare(right.kind));
}

function serializeJsonDocument(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

function sortJsonValue(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(compareJsonKeys)
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)])
    );
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

const jsonKeyOrder = [
  "$schema",
  "$id",
  "title",
  "description",
  "type",
  "const",
  "default",
  "enum",
  "minimum",
  "exclusiveMinimum",
  "minLength",
  "minItems",
  "items",
  "properties",
  "required",
  "additionalProperties",
  "anyOf",
  "oneOf"
] as const;

function compareJsonKeys([left]: [string, unknown], [right]: [string, unknown]): number {
  const leftIndex = jsonKeyOrder.indexOf(left as (typeof jsonKeyOrder)[number]);
  const rightIndex = jsonKeyOrder.indexOf(right as (typeof jsonKeyOrder)[number]);

  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) {
      return 1;
    }

    if (rightIndex === -1) {
      return -1;
    }

    return leftIndex - rightIndex;
  }

  return left.localeCompare(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
