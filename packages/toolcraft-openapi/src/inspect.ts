import { UserError } from "toolcraft";
import {
  collectGeneratedCommand,
  type GeneratedCommand,
  type OpenApiDocument,
  type OpenApiPathItemObject
} from "./generate.js";
import { normalizeOpenApiDocument } from "./normalize-swagger.js";
import {
  deriveDisambiguatedVerb,
  derivePathDisambiguatedVerb,
  type HttpMethod
} from "./naming.js";

const HTTP_METHOD_ORDER = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace"
] as const;

type InspectedHttpMethod = (typeof HTTP_METHOD_ORDER)[number];

export interface OpenApiInspectionOperation {
  method: Uppercase<InspectedHttpMethod>;
  path: string;
  operationId: string;
  summary?: string;
  status: "supported" | "unsupported";
  commandPath?: string;
  reason?: string;
}

export interface OpenApiInspectionReport {
  title?: string;
  version?: string;
  operationCount: number;
  supportedCount: number;
  unsupportedCount: number;
  operations: OpenApiInspectionOperation[];
}

export function inspectOpenApiDocument(document: OpenApiDocument): OpenApiInspectionReport {
  const normalizedDocument = normalizeOpenApiDocument(document);

  if (normalizedDocument.paths === undefined) {
    throw new UserError('OpenAPI document must define a top-level "paths" object.');
  }

  const operations = collectInspectionOperations(normalizedDocument);
  markCommandPathCollisions(operations);
  const supportedCount = operations.filter((operation) => operation.status === "supported").length;

  return {
    ...(normalizedDocument.info?.title === undefined ? {} : { title: normalizedDocument.info.title }),
    ...(normalizedDocument.info?.version === undefined ? {} : { version: normalizedDocument.info.version }),
    operationCount: operations.length,
    supportedCount,
    unsupportedCount: operations.length - supportedCount,
    operations
  };
}

function collectInspectionOperations(document: OpenApiDocument): OpenApiInspectionOperation[] {
  return Object.entries(document.paths ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([path, pathItem]) => {
      if (pathItem === undefined) {
        return [];
      }

      return HTTP_METHOD_ORDER.flatMap((method) => {
        const operation = (pathItem as Record<string, unknown>)[method];
        if (operation === undefined) {
          return [];
        }

        return [inspectOperation(document, path, pathItem, method, operation)];
      });
    });
}

function inspectOperation(
  document: OpenApiDocument,
  path: string,
  pathItem: OpenApiPathItemObject,
  method: InspectedHttpMethod,
  operation: unknown
): OpenApiInspectionOperation {
  const metadata = readOperationMetadata(path, method, operation);

  try {
    const command =
      method === "trace"
        ? undefined
        : collectGeneratedCommand(document, path, method);

    if (command === undefined) {
      throw new UserError(
        `Operation ${JSON.stringify(metadata.operationId)} uses unsupported HTTP method ${JSON.stringify(method.toUpperCase())}. Supported in v1: GET, POST, PUT, PATCH, DELETE.`
      );
    }

    return createSupportedOperation(metadata, command);
  } catch (error) {
    return {
      ...metadata,
      status: "unsupported",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function createSupportedOperation(
  metadata: Pick<OpenApiInspectionOperation, "method" | "path" | "operationId" | "summary">,
  command: GeneratedCommand
): OpenApiInspectionOperation {
  return {
    ...metadata,
    status: "supported",
    commandPath: `${command.noun} ${command.verb}`
  };
}

function readOperationMetadata(
  path: string,
  method: InspectedHttpMethod,
  operation: unknown
): Pick<OpenApiInspectionOperation, "method" | "path" | "operationId" | "summary"> {
  const operationObject = isObject(operation) ? operation : {};
  const operationId =
    typeof operationObject.operationId === "string"
      ? operationObject.operationId
      : `${method.toUpperCase()} ${path}`;
  const summary =
    typeof operationObject.summary === "string"
      ? operationObject.summary
      : typeof operationObject.description === "string"
        ? operationObject.description
        : undefined;

  return {
    method: method.toUpperCase() as Uppercase<InspectedHttpMethod>,
    path,
    operationId,
    ...(summary === undefined ? {} : { summary })
  };
}

function markCommandPathCollisions(operations: OpenApiInspectionOperation[]): void {
  const byCommandPath = new Map<string, OpenApiInspectionOperation[]>();

  for (const operation of operations) {
    if (operation.status !== "supported" || operation.commandPath === undefined) {
      continue;
    }

    const collisions = byCommandPath.get(operation.commandPath) ?? [];
    collisions.push(operation);
    byCommandPath.set(operation.commandPath, collisions);
  }

  for (const collisions of byCommandPath.values()) {
    if (collisions.length < 2) {
      continue;
    }

    const existingPaths = new Set(
      operations
        .filter((operation) => !collisions.includes(operation) && operation.commandPath !== undefined)
        .map((operation) => operation.commandPath as string)
    );
    const operationIdCandidates = collisions.map((operation) => {
      const noun = operation.commandPath?.split(" ")[0] ?? "";
      return { operation, commandPath: `${noun} ${deriveDisambiguatedVerb(operation.operationId, noun)}` };
    });

    if (applyInspectionCommandPaths(operationIdCandidates, existingPaths)) {
      continue;
    }

    const pathCandidates = collisions.map((operation) => {
        const [noun = "", verb = ""] = operation.commandPath?.split(" ") ?? [];
        const pathVerb = derivePathDisambiguatedVerb(
          operation.method.toLowerCase() as HttpMethod,
          operation.path,
          noun,
          verb
        );
        return { operation, commandPath: `${noun} ${pathVerb}` };
      });

    if (applyInspectionCommandPaths(pathCandidates, existingPaths)) {
      continue;
    }

    if (
      applyInspectionCommandPaths(
      collisions.map((operation) => {
        const [noun = "", verb = ""] = operation.commandPath?.split(" ") ?? [];
        const pathVerb = derivePathDisambiguatedVerb(
          operation.method.toLowerCase() as HttpMethod,
          operation.path,
          noun,
          verb,
          true
        );
        return { operation, commandPath: `${noun} ${pathVerb}` };
      }),
      existingPaths
      )
    ) {
      continue;
    }

    applyInspectionCommandPaths(
      collisions.map((operation) => {
        const [noun = "", verb = ""] = operation.commandPath?.split(" ") ?? [];
        const pathVerb = derivePathDisambiguatedVerb(
          operation.method.toLowerCase() as HttpMethod,
          operation.path,
          noun,
          verb,
          true,
          true
        );
        return { operation, commandPath: `${noun} ${pathVerb}` };
      }),
      existingPaths
    );
  }

  const remainingByCommandPath = new Map<string, OpenApiInspectionOperation[]>();
  for (const operation of operations) {
    if (operation.status !== "supported" || operation.commandPath === undefined) {
      continue;
    }

    remainingByCommandPath.set(operation.commandPath, [
      ...(remainingByCommandPath.get(operation.commandPath) ?? []),
      operation
    ]);
  }

  for (const [commandPath, collisions] of remainingByCommandPath) {
    if (collisions.length < 2) {
      continue;
    }

    const reason = `Generated command path ${JSON.stringify(commandPath)} is defined more than once (${collisions.map((operation) => JSON.stringify(operation.operationId)).join(" and ")}).`;
    for (const operation of collisions) {
      operation.status = "unsupported";
      operation.reason = reason;
    }
  }
}

function applyInspectionCommandPaths(
  candidates: Array<{ operation: OpenApiInspectionOperation; commandPath: string }>,
  existingPaths: ReadonlySet<string>
): boolean {
  const candidatePaths = candidates.map(({ commandPath }) => commandPath);

  if (
    candidates.some(({ commandPath }) => commandPath.endsWith(" ")) ||
    new Set(candidatePaths).size !== candidates.length ||
    candidatePaths.some((commandPath) => existingPaths.has(commandPath))
  ) {
    return false;
  }

  for (const { operation, commandPath } of candidates) {
    operation.commandPath = commandPath;
  }

  return true;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
