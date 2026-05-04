import {
  Budget,
  deepCopyFromSandbox,
  findExportedConstInitializer,
  parseModule,
  run
} from "@poe-code/agent-script";
import type { AnySchema as SchemaDescriptor } from "toolcraft-schema";

import { makeSchemaModule } from "../modules/schema.js";

const SCHEMA_EXTRACTION_BUDGET = {
  arrayLength: 1_000,
  maxCallDepth: 20,
  maxSteps: 200,
  stringLength: 100_000
} as const;

export async function extractSchema(
  ajsSource: string,
  ajsPath: string
): Promise<SchemaDescriptor | undefined> {
  const module = parseModule(ajsSource, ajsPath);
  const initializer = findExportedConstInitializer(module, "schema");

  if (initializer === undefined) {
    return undefined;
  }

  const initializerSource = ajsSource.slice(
    initializer.span.start.offset,
    initializer.span.end.offset
  );
  const result = await evaluateSchemaInitializer(initializerSource, ajsPath);

  if (!result.ok) {
    throwSchemaInitializerError(ajsPath, result.error.message);
  }

  return (await deepCopyFromSandbox(result.returnValue)) as SchemaDescriptor;
}

async function evaluateSchemaInitializer(initializerSource: string, ajsPath: string) {
  try {
    return await run(`import { S } from "schema"; return ${initializerSource};`, {
      budget: new Budget(SCHEMA_EXTRACTION_BUDGET),
      filename: ajsPath,
      modules: {
        schema: makeSchemaModule()
      }
    });
  } catch (error) {
    throwSchemaInitializerError(ajsPath, error);
  }
}

function throwSchemaInitializerError(ajsPath: string, cause: unknown): never {
  const detail = readErrorMessage(cause);
  throw new Error(
    `Failed to evaluate schema initializer in ${ajsPath}: schema initializer must be pure; only "schema" module imports allowed. ${detail}`,
    { cause }
  );
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return String(error);
}
