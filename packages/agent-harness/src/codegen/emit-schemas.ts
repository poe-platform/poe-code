import * as nodeFs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { toJsonSchema } from "toolcraft-schema";

import { extractSchema } from "../loader/extract-schema.js";

interface HarnessSchemaFileSystem {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  realpath(path: string): Promise<string>;
  rename(oldPath: string, newPath: string): Promise<unknown>;
  unlink(path: string): Promise<unknown>;
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
  const documents: Array<{ outputPath: string; stagedPath: string; serialized: string }> = [];

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
    const outputPath = path.join(outputDirectory, fileName);
    const stagedPath = path.join(outputDirectory, `.${fileName}.tmp`);

    await assertSafeSchemaOutput(repoRoot, outputPath, fs);
    await assertSafeSchemaOutput(repoRoot, stagedPath, fs);

    documents.push({
      outputPath,
      stagedPath,
      serialized: serializeJsonDocument(document)
    });
  }

  try {
    for (const document of documents) {
      await fs.writeFile(document.stagedPath, document.serialized, "utf8");
    }
  } catch (error) {
    await Promise.all(documents.map((document) => unlinkIfExists(document.stagedPath, fs)));
    throw error;
  }

  for (const document of documents) {
    await fs.rename(document.stagedPath, document.outputPath);
  }
}

async function unlinkIfExists(pathToRemove: string, fs: HarnessSchemaFileSystem): Promise<void> {
  try {
    await fs.unlink(pathToRemove);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
}

async function assertSafeSchemaOutput(
  repoRoot: string,
  outputPath: string,
  fs: Pick<HarnessSchemaFileSystem, "realpath">
): Promise<void> {
  let existingPath = outputPath;
  let canonicalOutputPath: string;

  while (true) {
    try {
      canonicalOutputPath = await fs.realpath(existingPath);
      break;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }

      const parentPath = path.dirname(existingPath);
      if (parentPath === existingPath) {
        throw error;
      }
      existingPath = parentPath;
    }
  }

  const canonicalRepoRoot = await fs.realpath(repoRoot);
  const relativeOutputPath = path.relative(canonicalRepoRoot, canonicalOutputPath);

  if (
    relativeOutputPath === ".." ||
    relativeOutputPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeOutputPath)
  ) {
    throw new Error("Generated schema output must remain inside the repository.");
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
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
