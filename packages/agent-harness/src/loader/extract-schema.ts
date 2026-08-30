import {
  Budget,
  deepCopyFromSandbox,
  findExportedConstInitializer,
  parseModule,
  run
} from "@poe-code/safe-js";
import type { AnySchema as SchemaDescriptor } from "toolcraft-schema";

import { makeSchemaModule } from "../modules/schema.js";

type ParsedModule = ReturnType<typeof parseModule>;
type ParsedStatement = ParsedModule["body"][number];
type ParsedVariableDeclaration = Extract<ParsedStatement, { type: "VariableDeclaration" }>;

const SCHEMA_EXTRACTION_BUDGET = {
  arrayLength: 1_000,
  dataSize: 200_000,
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
    throwSchemaInitializerError(
      ajsPath,
      result.error,
      findPriorOuterSchemaBinding(module, initializer.span.start.offset, result.error)
    );
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

function throwSchemaInitializerError(
  ajsPath: string,
  cause: unknown,
  outerSchemaBindingName?: string
): never {
  if (outerSchemaBindingName !== undefined) {
    throw new Error(
      `Failed to evaluate schema initializer in ${ajsPath}: schema initializer is evaluated in isolation; outer const '${outerSchemaBindingName}' is not in scope. Inline the value or move it into the schema literal.`,
      { cause }
    );
  }

  const detail = readErrorMessage(cause);
  throw new Error(
    `Failed to evaluate schema initializer in ${ajsPath}: schema initializer must be pure; only "schema" module imports allowed. ${detail}`,
    { cause }
  );
}

function findPriorOuterSchemaBinding(
  module: ParsedModule,
  initializerStartOffset: number,
  cause: unknown
): string | undefined {
  const unboundName = readUnboundIdentifierName(cause);
  if (unboundName === undefined) {
    return undefined;
  }

  return collectPriorTopLevelBindings(module, initializerStartOffset).has(unboundName)
    ? unboundName
    : undefined;
}

function collectPriorTopLevelBindings(
  module: ParsedModule,
  initializerStartOffset: number
): Set<string> {
  const bindingNames = new Set<string>();

  for (const statement of module.body) {
    const declaration = readVariableDeclaration(statement);
    if (declaration === undefined || (declaration.kind !== "const" && declaration.kind !== "let")) {
      continue;
    }

    for (const declarator of declaration.declarations) {
      if (
        declarator.id.type === "Identifier" &&
        declarator.id.span.start.offset < initializerStartOffset
      ) {
        bindingNames.add(declarator.id.name);
      }
    }
  }

  return bindingNames;
}

function readVariableDeclaration(
  statement: ParsedStatement
): ParsedVariableDeclaration | undefined {
  if (statement.type === "VariableDeclaration") {
    return statement;
  }

  if (statement.type === "ExportNamedDeclaration") {
    return statement.declaration;
  }

  return undefined;
}

function readUnboundIdentifierName(error: unknown): string | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !hasOwnProperty(error, "code") ||
    error.code !== "UNBOUND_IDENTIFIER"
  ) {
    return undefined;
  }

  const message = readErrorMessage(error);
  const prefix = "Identifier '";
  if (!message.startsWith(prefix)) {
    return undefined;
  }

  const nameEnd = message.indexOf("'", prefix.length);
  return nameEnd === -1 ? undefined : message.slice(prefix.length, nameEnd);
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    hasOwnProperty(error, "message") &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return String(error);
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}
