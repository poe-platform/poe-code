import { UserError } from "toolcraft";
import { isIdentifierName, toCliFlag } from "./naming.js";
import { REQUEST_PARAM_SECTIONS, type RequestParamSection, type RequestSectionKey } from "./request-shape.js";
import type {
  GeneratedParamDefinition,
  GeneratedPreflightBlock,
  GeneratedRequestField,
  GeneratedRequestLocation,
  GeneratedRequestSectionRender,
  GeneratedRequestSectionRenders,
  GeneratedValueExpression,
  GeneratedValueReference
} from "./generate.js";

interface EvaluationContext {
  params: Readonly<Record<string, unknown>>;
  resolvedValues: Readonly<Record<string, unknown>>;
}

interface PreflightExecutionContext {
  params: Readonly<Record<string, unknown>>;
  resolvedValues: Record<string, unknown>;
}

type GeneratedArrayDefinition = GeneratedParamDefinition & {
  kind: "array";
  itemDefinition: GeneratedParamDefinition;
};
type GeneratedNumberDefinition = GeneratedParamDefinition & { kind: "number" };
type GeneratedObjectDefinition = GeneratedParamDefinition & {
  kind: "object";
  properties: ReadonlyArray<{
    name: string;
    optional: boolean;
    definition: GeneratedParamDefinition;
  }>;
};
type GeneratedStringDefinition = GeneratedParamDefinition & { kind: "string" };

interface RequestSectionOperation {
  render: (
    section: RequestParamSection,
    sectionFields: ReadonlyArray<GeneratedRequestField>,
    optional: boolean
  ) => string[];
  build: (
    section: RequestParamSection,
    sectionFields: ReadonlyArray<GeneratedRequestField>,
    optional: boolean,
    context: EvaluationContext
  ) => unknown;
}

const QUERY_ARRAY_SERIALIZATION_SEPARATORS = {
  comma: ",",
  pipe: "|"
} as const;

const VALUE_REFERENCE_OPERATIONS = {
  param: {
    render: (reference: Extract<GeneratedValueReference, { kind: "param" }>) =>
      renderParamAccess(reference.paramName),
    evaluate: (
      reference: Extract<GeneratedValueReference, { kind: "param" }>,
      context: EvaluationContext
    ) => readOwnParam(context.params, reference.paramName)
  },
  resolved: {
    render: (reference: Extract<GeneratedValueReference, { kind: "resolved" }>) =>
      reference.resolvedName,
    evaluate: (
      reference: Extract<GeneratedValueReference, { kind: "resolved" }>,
      context: EvaluationContext
    ) => context.resolvedValues[reference.resolvedName]
  }
} as const satisfies {
  [K in GeneratedValueReference["kind"]]: {
    render: (reference: Extract<GeneratedValueReference, { kind: K }>) => string;
    evaluate: (
      reference: Extract<GeneratedValueReference, { kind: K }>,
      context: EvaluationContext
    ) => unknown;
  };
};

const VALUE_EXPRESSION_OPERATIONS = {
  emptyObject: {
    render: (_value: Extract<GeneratedValueExpression, { kind: "emptyObject" }>) => "{}",
    evaluate: (_value: Extract<GeneratedValueExpression, { kind: "emptyObject" }>) => ({})
  },
  reference: {
    render: (value: Extract<GeneratedValueExpression, { kind: "reference" }>) =>
      renderValueReference(value.reference),
    evaluate: (
      value: Extract<GeneratedValueExpression, { kind: "reference" }>,
      context: EvaluationContext
    ) => evaluateValueReference(value.reference, context)
  },
  queryArray: {
    render: (value: Extract<GeneratedValueExpression, { kind: "queryArray" }>) =>
      renderSerializedQueryArray(
        renderValueReference(value.reference),
        value.serialization
      ),
    evaluate: (
      value: Extract<GeneratedValueExpression, { kind: "queryArray" }>,
      context: EvaluationContext
    ) => serializeQueryArrayValue(
      evaluateValueReference(value.reference, context),
      value.serialization
    )
  }
} as const satisfies {
  [K in GeneratedValueExpression["kind"]]: {
    render: (value: Extract<GeneratedValueExpression, { kind: K }>) => string;
    evaluate: (
      value: Extract<GeneratedValueExpression, { kind: K }>,
      context: EvaluationContext
    ) => unknown;
  };
};

const PREFLIGHT_BLOCK_OPERATIONS = {
  "scalar-null": {
    render: (block: Extract<GeneratedPreflightBlock, { kind: "scalar-null" }>) => {
      const paramAccess = renderParamAccess(block.paramName);
      const nullAccess = renderParamAccess(block.nullParamName);

      return [
        `    if (${paramAccess} !== undefined && ${paramAccess} !== null && ${nullAccess}) {`,
        `      throw new UserError(${JSON.stringify(getScalarNullConflictMessage(block))});`,
        "    }",
        `    const ${block.resolvedName} = ${nullAccess} ? null : ${paramAccess};`,
        ...(block.required
          ? [
              `    if (${block.resolvedName} === undefined) {`,
              `      throw new UserError(${JSON.stringify(getMissingRequiredParameterMessage(block.paramName))});`,
              "    }"
            ]
          : [])
      ];
    },
    execute: (
      block: Extract<GeneratedPreflightBlock, { kind: "scalar-null" }>,
      context: PreflightExecutionContext
    ) => {
      const value = context.params[block.paramName];
      const nullRequested = context.params[block.nullParamName] === true;

      if (value !== undefined && value !== null && nullRequested) {
        throw new UserError(getScalarNullConflictMessage(block));
      }

      context.resolvedValues[block.resolvedName] = nullRequested ? null : value;

      if (block.required && context.resolvedValues[block.resolvedName] === undefined) {
        throw new UserError(getMissingRequiredParameterMessage(block.paramName));
      }
    }
  },
  array: {
    render: (block: Extract<GeneratedPreflightBlock, { kind: "array" }>) => {
      const paramAccess = renderParamAccess(block.paramName);
      const jsonAccess = renderParamAccess(block.jsonParamName);

      return [
        ...(block.nullParamName === undefined
          ? []
          : [
              `    if (${renderParamAccess(block.nullParamName)} && (${paramAccess} !== undefined || ${jsonAccess} !== undefined)) {`,
              `      throw new UserError(${JSON.stringify(getArrayNullConflictMessage(block))});`,
              "    }"
            ]),
        `    if (${paramAccess} !== undefined && ${jsonAccess} !== undefined) {`,
        `      throw new UserError(${JSON.stringify(getArrayJsonConflictMessage(block))});`,
        "    }",
        `    let ${block.resolvedName} = ${paramAccess};`,
        `    if (${jsonAccess} !== undefined) {`,
        "      let parsedJson: unknown;",
        "      try {",
        `        parsedJson = JSON.parse(${jsonAccess});`,
        "      } catch (error) {",
        `        throw new UserError(${JSON.stringify(getInvalidArrayJsonMessage(block.jsonParamName, "Expected valid JSON."))});`,
        "      }",
        "      if (!Array.isArray(parsedJson)) {",
        `        throw new UserError(${JSON.stringify(getInvalidArrayJsonMessage(block.jsonParamName, "Expected a JSON array."))});`,
        "      }",
        `      validateArrayJsonHelperValue(parsedJson, ${JSON.stringify(block.definition)}, ${JSON.stringify(block.jsonParamName)});`,
        `      ${block.resolvedName} = parsedJson;`,
        "    }",
        ...(block.nullParamName === undefined
          ? []
          : [
              `    if (${renderParamAccess(block.nullParamName)}) {`,
              `      ${block.resolvedName} = null;`,
              "    }"
            ]),
        ...(block.required
          ? [
              `    if (${block.resolvedName} === undefined) {`,
              `      throw new UserError(${JSON.stringify(getMissingRequiredParameterMessage(block.paramName))});`,
              "    }"
            ]
          : [])
      ];
    },
    execute: (
      block: Extract<GeneratedPreflightBlock, { kind: "array" }>,
      context: PreflightExecutionContext
    ) => {
      const directValue = context.params[block.paramName];
      const jsonValue = context.params[block.jsonParamName];
      const nullRequested =
        block.nullParamName !== undefined && context.params[block.nullParamName] === true;

      if (block.nullParamName !== undefined && nullRequested && (directValue !== undefined || jsonValue !== undefined)) {
        throw new UserError(getArrayNullConflictMessage(block));
      }

      if (directValue !== undefined && jsonValue !== undefined) {
        throw new UserError(getArrayJsonConflictMessage(block));
      }

      let resolved = directValue;

      if (jsonValue !== undefined) {
        let parsedJson: unknown;

        try {
          parsedJson = JSON.parse(String(jsonValue));
        } catch {
          throw new UserError(getInvalidArrayJsonMessage(block.jsonParamName, "Expected valid JSON."));
        }

        if (!Array.isArray(parsedJson)) {
          throw new UserError(getInvalidArrayJsonMessage(block.jsonParamName, "Expected a JSON array."));
        }

        validateArrayJsonHelperValue(parsedJson, block.definition, block.jsonParamName);
        resolved = parsedJson;
      }

      if (nullRequested) {
        resolved = null;
      }

      if (block.required && resolved === undefined) {
        throw new UserError(getMissingRequiredParameterMessage(block.paramName));
      }

      context.resolvedValues[block.resolvedName] = resolved;
    }
  }
} as const satisfies {
  [K in GeneratedPreflightBlock["kind"]]: {
    render: (block: Extract<GeneratedPreflightBlock, { kind: K }>) => string[];
    execute: (
      block: Extract<GeneratedPreflightBlock, { kind: K }>,
      context: PreflightExecutionContext
    ) => void;
  };
};

const REQUEST_SECTION_OPERATIONS = {
  inline: {
    render: (section, sectionFields, optional) => {
      const [field] = sectionFields;

      if (field === undefined) {
        return [];
      }

      if (!optional) {
        return [`      ${section.key}: ${renderValueExpression(field.value)},`];
      }

      return [
        `      ...(${renderOmitWhenUndefinedExpression(field.omitWhenUndefinedReference)}`,
        "        ? {}",
        "        : {",
        `            ${section.key}: ${renderValueExpression(field.value)},`,
        "          }),"
      ];
    },
    build: (_section, sectionFields, optional, context) => {
      const [field] = sectionFields;

      if (field === undefined) {
        return undefined;
      }

      if (optional && evaluateValueReference(field.omitWhenUndefinedReference, context) === undefined) {
        return undefined;
      }

      return evaluateValueExpression(field.value, context);
    }
  },
  wrapped: {
    render: (section, sectionFields, optional) => {
      if (!optional) {
        return [
          `      ${section.key}: {`,
          ...sectionFields.map(
            (field) => `        ${renderWireName(field.wireName)}: ${renderValueExpression(field.value)},`
          ),
          "      },"
        ];
      }

      return [
        `      ...(${sectionFields.map((field) => renderOmitWhenUndefinedExpression(field.omitWhenUndefinedReference)).join(" && ")}`,
        "        ? {}",
        "        : {",
        `            ${section.key}: {`,
        ...sectionFields.map(
          (field) => `              ${renderWireName(field.wireName)}: ${renderValueExpression(field.value)},`
        ),
        "            },",
        "          }),"
      ];
    },
    build: (_section, sectionFields, optional, context) => {
      if (
        optional &&
        sectionFields.every(
          (field) => evaluateValueReference(field.omitWhenUndefinedReference, context) === undefined
        )
      ) {
        return undefined;
      }

      return Object.fromEntries(
        sectionFields.map((field) => [field.wireName, evaluateValueExpression(field.value, context)])
      );
    }
  }
} as const satisfies Record<GeneratedRequestSectionRender, RequestSectionOperation>;

export function renderPreflightBlock(block: GeneratedPreflightBlock): string[] {
  return PREFLIGHT_BLOCK_OPERATIONS[block.kind].render(block as never);
}

export function executePreflightBlocks(
  blocks: ReadonlyArray<GeneratedPreflightBlock>,
  params: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const resolvedValues: Record<string, unknown> = {};

  for (const block of blocks) {
    PREFLIGHT_BLOCK_OPERATIONS[block.kind].execute(block as never, {
      params,
      resolvedValues
    });
  }

  return resolvedValues;
}

export function validateArrayJsonHelperValue(
  value: unknown,
  definition: GeneratedArrayDefinition,
  jsonParamName: string
): void {
  const issue = findDefinitionIssue(value, definition, []);

  if (issue !== undefined) {
    throw new UserError(getInvalidArrayJsonMessage(jsonParamName, issue));
  }
}

function findDefinitionIssue(
  value: unknown,
  definition: GeneratedParamDefinition,
  path: readonly string[]
): string | undefined {
  if (value === null) {
    return definition.nullable === true || definition.kind === "json"
      ? undefined
      : `Expected ${expectedDefinition(definition)} at ${formatJsonPath(path)}.`;
  }

  switch (definition.kind) {
    case "array":
      return findArrayDefinitionIssue(value, definition, path);
    case "boolean":
      return typeof value === "boolean"
        ? undefined
        : `Expected boolean at ${formatJsonPath(path)}.`;
    case "enum":
      return definition.enumValues.includes(value as never)
        ? undefined
        : `Expected one of ${definition.enumValues.join(", ")} at ${formatJsonPath(path)}.`;
    case "json":
      return undefined;
    case "number":
      return findNumberDefinitionIssue(value, definition as GeneratedNumberDefinition, path);
    case "object":
      return findObjectDefinitionIssue(value, definition as GeneratedObjectDefinition, path);
    case "string":
      return findStringDefinitionIssue(value, definition as GeneratedStringDefinition, path);
  }
}

function findArrayDefinitionIssue(
  value: unknown,
  definition: GeneratedArrayDefinition,
  path: readonly string[]
): string | undefined {
  if (!Array.isArray(value)) {
    return `Expected array at ${formatJsonPath(path)}.`;
  }

  if (definition.minItems !== undefined && value.length < definition.minItems) {
    return `Expected array with at least ${definition.minItems} items at ${formatJsonPath(path)}.`;
  }

  if (definition.maxItems !== undefined && value.length > definition.maxItems) {
    return `Expected array with at most ${definition.maxItems} items at ${formatJsonPath(path)}.`;
  }

  for (const [index, item] of value.entries()) {
    const issue = findDefinitionIssue(item, definition.itemDefinition, [...path, String(index)]);

    if (issue !== undefined) {
      return issue;
    }
  }

  return undefined;
}

function findObjectDefinitionIssue(
  value: unknown,
  definition: GeneratedObjectDefinition,
  path: readonly string[]
): string | undefined {
  if (!isJsonObject(value)) {
    return `Expected object at ${formatJsonPath(path)}.`;
  }

  const knownProperties = new Set(definition.properties.map((property) => property.name));

  for (const property of definition.properties) {
    if (!Object.prototype.hasOwnProperty.call(value, property.name)) {
      if (property.optional) {
        continue;
      }

      return `Expected required property ${JSON.stringify(property.name)} at ${formatJsonPath(path)}.`;
    }

    const issue = findDefinitionIssue(value[property.name], property.definition, [
      ...path,
      property.name
    ]);

    if (issue !== undefined) {
      return issue;
    }
  }

  if (definition.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!knownProperties.has(key)) {
        return `Unexpected property ${JSON.stringify(key)} at ${formatJsonPath(path)}.`;
      }
    }
  }

  return undefined;
}

function findNumberDefinitionIssue(
  value: unknown,
  definition: GeneratedNumberDefinition,
  path: readonly string[]
): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `Expected ${definition.jsonType === "integer" ? "integer" : "number"} at ${formatJsonPath(path)}.`;
  }

  if (definition.jsonType === "integer" && !Number.isInteger(value)) {
    return `Expected integer at ${formatJsonPath(path)}.`;
  }

  if (definition.minimum !== undefined && value < definition.minimum) {
    return `Expected number greater than or equal to ${definition.minimum} at ${formatJsonPath(path)}.`;
  }

  if (definition.maximum !== undefined && value > definition.maximum) {
    return `Expected number less than or equal to ${definition.maximum} at ${formatJsonPath(path)}.`;
  }

  return undefined;
}

function findStringDefinitionIssue(
  value: unknown,
  definition: GeneratedStringDefinition,
  path: readonly string[]
): string | undefined {
  if (typeof value !== "string") {
    return `Expected string at ${formatJsonPath(path)}.`;
  }

  if (definition.minLength !== undefined && value.length < definition.minLength) {
    return `Expected string with length at least ${definition.minLength} at ${formatJsonPath(path)}.`;
  }

  if (definition.maxLength !== undefined && value.length > definition.maxLength) {
    return `Expected string with length at most ${definition.maxLength} at ${formatJsonPath(path)}.`;
  }

  if (definition.pattern !== undefined) {
    const pattern = compileDefinitionPattern(definition.pattern);

    if (pattern === undefined || !pattern.test(value)) {
      return `Expected string matching pattern ${definition.pattern} at ${formatJsonPath(path)}.`;
    }
  }

  return undefined;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compileDefinitionPattern(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern, "u");
  } catch {
    return undefined;
  }
}

function expectedDefinition(definition: GeneratedParamDefinition): string {
  return definition.kind === "number" && definition.jsonType === "integer"
    ? "integer"
    : definition.kind;
}

function formatJsonPath(path: readonly string[]): string {
  if (path.length === 0) {
    return "the JSON array";
  }

  return path.map((segment) => `[${segment}]`).join("");
}

export function renderRequestShape(
  requestFields: ReadonlyArray<GeneratedRequestField>,
  sectionRenders: GeneratedRequestSectionRenders,
  optionalSections: ReadonlySet<GeneratedRequestLocation>
): string[] {
  const lines: string[] = [];

  for (const section of REQUEST_PARAM_SECTIONS) {
    const sectionFields = requestFields.filter((field) => field.location === section.location);

    if (sectionFields.length === 0) {
      continue;
    }

    const renderKind = sectionRenders[section.location];

    if (renderKind === undefined) {
      continue;
    }

    lines.push(
      ...REQUEST_SECTION_OPERATIONS[renderKind].render(
        section,
        sectionFields,
        optionalSections.has(section.location)
      )
    );
  }

  return lines;
}

export function buildRequestShape(
  requestFields: ReadonlyArray<GeneratedRequestField>,
  sectionRenders: GeneratedRequestSectionRenders,
  optionalSections: ReadonlySet<GeneratedRequestLocation>,
  params: Readonly<Record<string, unknown>>,
  resolvedValues: Readonly<Record<string, unknown>>
): Partial<Record<RequestSectionKey, unknown>> {
  const requestShape: Partial<Record<RequestSectionKey, unknown>> = {};
  const context = { params, resolvedValues };

  for (const section of REQUEST_PARAM_SECTIONS) {
    const sectionFields = requestFields.filter((field) => field.location === section.location);

    if (sectionFields.length === 0) {
      continue;
    }

    const renderKind = sectionRenders[section.location];

    if (renderKind === undefined) {
      continue;
    }

    const builtSection = REQUEST_SECTION_OPERATIONS[renderKind].build(
      section,
      sectionFields,
      optionalSections.has(section.location),
      context
    );

    if (builtSection !== undefined) {
      requestShape[section.key] = builtSection;
    }
  }

  return requestShape;
}

function getScalarNullConflictMessage(
  block: Extract<GeneratedPreflightBlock, { kind: "scalar-null" }>
): string {
  return `Options "--${toCliFlag(block.paramName)}" and "--${toCliFlag(block.nullParamName)}" are mutually exclusive.`;
}

function getArrayNullConflictMessage(
  block: Extract<GeneratedPreflightBlock, { kind: "array" }>
): string {
  const nullParamName = block.nullParamName;

  if (nullParamName === undefined) {
    throw new Error("Missing null helper for nullable array preflight block.");
  }

  return `Options "--${toCliFlag(nullParamName)}", "--${toCliFlag(block.paramName)}", and "--${toCliFlag(block.jsonParamName)}" cannot be combined.`;
}

function getArrayJsonConflictMessage(
  block: Extract<GeneratedPreflightBlock, { kind: "array" }>
): string {
  return `Options "--${toCliFlag(block.paramName)}" and "--${toCliFlag(block.jsonParamName)}" are mutually exclusive.`;
}

function getInvalidArrayJsonMessage(paramName: string, expectation: string): string {
  return `Invalid value for "--${toCliFlag(paramName)}". ${expectation}`;
}

function getMissingRequiredParameterMessage(paramName: string): string {
  return `Missing required parameter "${toCliFlag(paramName)}".`;
}

function renderValueReference(reference: GeneratedValueReference): string {
  return VALUE_REFERENCE_OPERATIONS[reference.kind].render(reference as never);
}

function evaluateValueReference(reference: GeneratedValueReference, context: EvaluationContext): unknown {
  return VALUE_REFERENCE_OPERATIONS[reference.kind].evaluate(reference as never, context);
}

function renderValueExpression(value: GeneratedValueExpression): string {
  return VALUE_EXPRESSION_OPERATIONS[value.kind].render(value as never);
}

function evaluateValueExpression(value: GeneratedValueExpression, context: EvaluationContext): unknown {
  return VALUE_EXPRESSION_OPERATIONS[value.kind].evaluate(value as never, context);
}

function renderSerializedQueryArray(
  reference: string,
  serialization: Extract<GeneratedValueExpression, { kind: "queryArray" }>['serialization']
): string {
  if (serialization === "repeat" || serialization === "brackets") {
    return reference;
  }

  return `${reference} === undefined || ${reference} === null ? ${reference} : ${reference}.join(${JSON.stringify(QUERY_ARRAY_SERIALIZATION_SEPARATORS[serialization])})`;
}

function serializeQueryArrayValue(
  value: unknown,
  serialization: Extract<GeneratedValueExpression, { kind: "queryArray" }>['serialization']
): unknown {
  if (serialization === "repeat" || serialization === "brackets" || value === undefined || value === null) {
    return value;
  }

  return Array.isArray(value) ? value.join(QUERY_ARRAY_SERIALIZATION_SEPARATORS[serialization]) : value;
}

function renderOmitWhenUndefinedExpression(reference: GeneratedValueReference): string {
  return `${renderValueReference(reference)} === undefined`;
}

function renderParamAccess(name: string): string {
  if (Object.prototype.hasOwnProperty.call(Object.prototype, name)) {
    return `(Object.prototype.hasOwnProperty.call(params, ${JSON.stringify(name)}) ? params[${JSON.stringify(name)}] : undefined)`;
  }

  return isIdentifierName(name) ? `params.${name}` : `params[${JSON.stringify(name)}]`;
}

function renderWireName(name: string): string {
  return name === "__proto__" ? `[${JSON.stringify(name)}]` : JSON.stringify(name);
}

function readOwnParam(params: Readonly<Record<string, unknown>>, name: string): unknown {
  return Object.prototype.hasOwnProperty.call(params, name) ? params[name] : undefined;
}
