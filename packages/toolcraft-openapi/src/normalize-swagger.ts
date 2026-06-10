import type {
  OpenApiDocument,
  OpenApiOperationObject,
  OpenApiParameter,
  OpenApiPathItemObject,
  OpenApiReferenceObject,
  OpenApiRequestBodyObject,
  OpenApiResponseObject,
  OpenApiSchemaObject
} from "./generate.js";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const;
const SCHEMA_PARAMETER_KEYS = [
  "type",
  "format",
  "items",
  "default",
  "enum",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems"
] as const;

type UnknownRecord = Record<string, unknown>;
type NormalizedSwaggerParameter = OpenApiParameter | SwaggerBodyParameter | SwaggerFormParameter;

export function normalizeOpenApiDocument(document: OpenApiDocument): OpenApiDocument {
  const source = document as OpenApiDocument & UnknownRecord;

  if (source.swagger !== "2.0") {
    return document;
  }

  const consumes = readStringArray(source.consumes);
  const produces = readStringArray(source.produces);
  const paths = Object.fromEntries(
    Object.entries(source.paths ?? {}).map(([path, pathItem]) => [
      path,
      pathItem === undefined
        ? undefined
        : normalizePathItem(
            pathItem as OpenApiPathItemObject & UnknownRecord,
            consumes,
            produces,
            isRecord(source.parameters) ? source.parameters : {}
          )
    ])
  );
  const components = {
    ...(source.components ?? {}),
    ...(!isRecord(source.definitions) ? {} : { schemas: rewriteReferences(source.definitions) }),
    ...(!isRecord(source.parameters) ? {} : { parameters: rewriteReferences(source.parameters) }),
    ...(!isRecord(source.responses) ? {} : { responses: rewriteReferences(source.responses) }),
    ...(!isRecord(source.securityDefinitions)
      ? {}
      : { securitySchemes: rewriteReferences(source.securityDefinitions) })
  };

  return rewriteReferences({
    ...source,
    openapi: "3.0.3",
    paths,
    components
  }) as OpenApiDocument;
}

function normalizePathItem(
  pathItem: OpenApiPathItemObject & UnknownRecord,
  documentConsumes: string[],
  documentProduces: string[],
  reusableParameters: UnknownRecord
): OpenApiPathItemObject {
  const normalized = {
    ...pathItem,
    ...(pathItem.parameters === undefined
      ? {}
      : { parameters: pathItem.parameters.map((parameter) => normalizeParameter(resolveReusableParameter(parameter, reusableParameters))).filter(isOpenApiParameter) })
  } as UnknownRecord;

  for (const method of HTTP_METHODS) {
    const operation = pathItem[method];
    if (!isRecord(operation) || isReferenceObject(operation)) {
      continue;
    }

    normalized[method] = normalizeOperation(
      operation,
      documentConsumes,
      documentProduces,
      reusableParameters
    );
  }

  return normalized as OpenApiPathItemObject;
}

function normalizeOperation(
  operation: OpenApiOperationObject & UnknownRecord,
  documentConsumes: string[],
  documentProduces: string[],
  reusableParameters: UnknownRecord
): OpenApiOperationObject {
  const parameters = (operation.parameters ?? []).map((parameter) =>
    normalizeParameter(resolveReusableParameter(parameter, reusableParameters))
  );
  const body = parameters.find(isSwaggerBodyParameter);
  const formParameters = parameters.filter(isSwaggerFormParameter);
  const nonBodyParameters = parameters.filter(
    (parameter): parameter is OpenApiParameter => isOpenApiParameter(parameter) && !isSwaggerFormParameter(parameter)
  );
  const consumes = readStringArray(operation.consumes).length > 0
    ? readStringArray(operation.consumes)
    : documentConsumes;
  const produces = readStringArray(operation.produces).length > 0
    ? readStringArray(operation.produces)
    : documentProduces;

  return {
    ...operation,
    parameters: nonBodyParameters,
    ...(body !== undefined
      ? { requestBody: normalizeBodyParameter(body, consumes) }
      : formParameters.length === 0
        ? {}
        : { requestBody: normalizeFormParameters(formParameters, consumes) }),
    responses: Object.fromEntries(
      Object.entries(operation.responses ?? {}).map(([status, response]) => [
        status,
        normalizeResponse(response, produces)
      ])
    )
  };
}

function resolveReusableParameter(
  parameter: OpenApiParameter | UnknownRecord,
  reusableParameters: UnknownRecord
): OpenApiParameter | UnknownRecord {
  if (!isReferenceObject(parameter) || !parameter.$ref.startsWith("#/parameters/")) {
    return parameter;
  }

  return reusableParameters[parameter.$ref.slice("#/parameters/".length)] as
    | OpenApiParameter
    | UnknownRecord;
}

function normalizeParameter(parameter: OpenApiParameter | UnknownRecord): NormalizedSwaggerParameter {
  if (isReferenceObject(parameter)) {
    return { $ref: rewriteReference(parameter.$ref) };
  }

  if (parameter.in === "body") {
    return {
      in: "body",
      required: parameter.required === true,
      description: typeof parameter.description === "string" ? parameter.description : undefined,
      schema: rewriteReferences(parameter.schema ?? {}) as OpenApiSchemaObject | OpenApiReferenceObject
    };
  }

  const parameterRecord = parameter as UnknownRecord;
  const schema = isRecord(parameterRecord.schema)
    ? parameterRecord.schema
    : Object.fromEntries(
        SCHEMA_PARAMETER_KEYS.flatMap((key) =>
          parameterRecord[key] === undefined ? [] : [[key, parameterRecord[key]]]
        )
      );

  const normalized = {
    ...parameter,
    schema: rewriteReferences(
      parameter.in === "formData" && parameterRecord.type === "file"
        ? { type: "string", format: "binary" }
        : schema
    ) as OpenApiSchemaObject | OpenApiReferenceObject
  };

  return parameter.in === "formData"
    ? (normalized as SwaggerFormParameter)
    : (normalized as OpenApiParameter);
}

function normalizeBodyParameter(
  parameter: SwaggerBodyParameter,
  consumes: string[]
): OpenApiRequestBodyObject {
  const mediaTypes = consumes.length === 0 ? ["application/json"] : consumes;

  return {
    ...(parameter.description === undefined ? {} : { description: parameter.description }),
    ...(parameter.required ? { required: true } : {}),
    content: Object.fromEntries(mediaTypes.map((mediaType) => [mediaType, { schema: parameter.schema }]))
  };
}

function normalizeResponse(
  response: OpenApiResponseObject | OpenApiReferenceObject | UnknownRecord,
  produces: string[]
): OpenApiResponseObject | OpenApiReferenceObject {
  if (isReferenceObject(response)) {
    return { $ref: rewriteReference(response.$ref) };
  }

  const responseRecord = response as UnknownRecord;

  if (responseRecord.schema === undefined) {
    return response as OpenApiResponseObject;
  }

  const mediaTypes = produces.length === 0 ? ["application/json"] : produces;
  return {
    ...response,
    content: Object.fromEntries(
      mediaTypes.map((mediaType) => [
        mediaType,
        { schema: rewriteReferences(responseRecord.schema) as OpenApiSchemaObject | OpenApiReferenceObject }
      ])
    )
  };
}

interface SwaggerBodyParameter {
  in: "body";
  required: boolean;
  description?: string;
  schema: OpenApiSchemaObject | OpenApiReferenceObject;
}

interface SwaggerFormParameter {
  in: "formData";
  name: string;
  required?: boolean;
  description?: string;
  schema: OpenApiSchemaObject | OpenApiReferenceObject;
}

function isSwaggerBodyParameter(parameter: NormalizedSwaggerParameter): parameter is SwaggerBodyParameter {
  return !isReferenceObject(parameter) && parameter.in === "body";
}

function isSwaggerFormParameter(
  parameter: NormalizedSwaggerParameter
): parameter is SwaggerFormParameter {
  return !isReferenceObject(parameter) && parameter.in === "formData";
}

function normalizeFormParameters(
  parameters: SwaggerFormParameter[],
  consumes: string[]
): OpenApiRequestBodyObject {
  const required = parameters.filter((parameter) => parameter.required === true).map((parameter) => parameter.name);
  const mediaType =
    consumes.find((value) => value.toLowerCase() === "multipart/form-data") ??
    "application/x-www-form-urlencoded";

  return {
    ...(required.length === 0 ? {} : { required: true }),
    content: {
      [mediaType]: {
        schema: {
          type: "object",
          ...(required.length === 0 ? {} : { required }),
          properties: Object.fromEntries(
            parameters.map((parameter) => [
              parameter.name,
              {
                ...parameter.schema,
                ...(parameter.description === undefined ? {} : { description: parameter.description })
              }
            ])
          )
        }
      }
    }
  };
}

function isOpenApiParameter(parameter: NormalizedSwaggerParameter): parameter is OpenApiParameter {
  return isReferenceObject(parameter) || (parameter.in !== "body" && parameter.in !== "formData");
}

function isReferenceObject(value: unknown): value is OpenApiReferenceObject {
  return isRecord(value) && typeof value.$ref === "string";
}

function rewriteReferences<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteReferences(entry)) as T;
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "$ref" && typeof entry === "string" ? rewriteReference(entry) : rewriteReferences(entry)
    ])
  ) as T;
}

function rewriteReference(reference: string): string {
  return reference
    .replace("#/definitions/", "#/components/schemas/")
    .replace("#/parameters/", "#/components/parameters/")
    .replace("#/responses/", "#/components/responses/");
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
