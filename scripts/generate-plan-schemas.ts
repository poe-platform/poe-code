#!/usr/bin/env tsx
import * as nodeFs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planDocumentSchema } from "../src/plan/document-schema.js";
import { experimentDocumentSchema } from "../packages/experiment-loop/src/frontmatter/frontmatter.js";
import { pipelineDocumentSchema } from "../packages/pipeline/src/plan/parser.js";
import { ralphDocumentSchema } from "../packages/ralph/src/frontmatter/frontmatter.js";
import {
  superintendentBaseDocumentSchema,
  superintendentDocumentSchema
} from "../packages/superintendent/src/document/parse.js";

interface PlanSchemaFileSystem {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  writeFile(
    filePath: string,
    data: string,
    options?: BufferEncoding | { encoding?: BufferEncoding }
  ): Promise<unknown>;
}

interface RunPlanSchemaCodegenOptions {
  fs?: PlanSchemaFileSystem;
  repoRoot?: string;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

export const planSchemaDocuments = [
  {
    fileName: "plan.schema.json",
    schema: planDocumentSchema
  },
  {
    fileName: "pipeline.schema.json",
    schema: pipelineDocumentSchema
  },
  {
    fileName: "experiment.schema.json",
    schema: experimentDocumentSchema
  },
  {
    fileName: "ralph.schema.json",
    schema: ralphDocumentSchema
  },
  {
    fileName: "superintendent.schema.json",
    schema: superintendentDocumentSchema
  },
  {
    fileName: "superintendent-base.schema.json",
    schema: superintendentBaseDocumentSchema
  }
] as const;

export function serializeJsonDocument(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

export async function runPlanSchemaCodegen(
  options: RunPlanSchemaCodegenOptions = {}
): Promise<void> {
  const fs = options.fs ?? nodeFs;
  const repoRoot = options.repoRoot ?? resolveRepoRoot();
  const outputDirectory = path.join(repoRoot, "docs", "schemas", "plans");

  await fs.mkdir(outputDirectory, { recursive: true });

  for (const document of planSchemaDocuments) {
    await fs.writeFile(
      path.join(outputDirectory, document.fileName),
      serializeJsonDocument(document.schema),
      "utf8"
    );
  }
}

function resolveRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  "anyOf"
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPlanSchemaCodegen().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
