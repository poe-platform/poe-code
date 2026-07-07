import type { AnySchema, ObjectSchema, OptionalSchema, Static } from "./index.js";
import { getRequiredKeyFingerprint } from "./union.js";

export type SchemaDescriptor = AnySchema;

export type ValidationIssue = {
  path: readonly string[];
  expected: string;
  received: string;
  message: string;
  keyword?: string;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: readonly ValidationIssue[] };

type ValidationState = {
  issues: ValidationIssue[];
};

type WalkResult = { present: true; value: unknown } | { present: false };

const missingValue = Symbol("missingValue");

export function validate<S extends SchemaDescriptor>(
  schema: S,
  value: unknown
): ValidationResult<Static<S>> {
  const state: ValidationState = { issues: [] };
  const result = walkSchema(schema, value, [], state);

  if (state.issues.length > 0) {
    return { ok: false, issues: state.issues };
  }

  return { ok: true, value: (result.present ? result.value : undefined) as Static<S> };
}

function walkSchema(
  schema: AnySchema,
  value: unknown | typeof missingValue,
  path: readonly string[],
  state: ValidationState
): WalkResult {
  if (schema.kind === "optional") {
    return walkOptional(schema, value, path, state);
  }

  if (value === missingValue) {
    addIssue(
      state,
      path,
      expectedFor(schema),
      "missing",
      `Expected ${expectedFor(schema)} at ${formatPath(path)}`
    );
    return { present: false };
  }

  if (value === null && schema.nullable === true) {
    return { present: true, value };
  }

  switch (schema.kind) {
    case "string":
      return walkString(schema, value, path, state);

    case "number":
      return walkNumber(schema, value, path, state);

    case "boolean":
      return walkBoolean(value, path, state);

    case "enum":
      return walkEnum(schema, value, path, state);

    case "array":
      return walkArray(schema, value, path, state);

    case "object":
      return walkObject(schema, value, path, state);

    case "oneOf":
      return walkOneOf(schema, value, path, state);

    case "union":
      return walkUnion(schema, value, path, state);

    case "record":
      return walkRecord(schema, value, path, state);

    case "json":
      return walkJson(value, path, state);
  }
}

function walkOptional(
  schema: OptionalSchema<AnySchema>,
  value: unknown | typeof missingValue,
  path: readonly string[],
  state: ValidationState
): WalkResult {
  if (value === missingValue || value === undefined) {
    const defaultValue = getDefault(schema.inner);

    if (defaultValue.present) {
      return walkSchema(schema.inner, cloneDefault(defaultValue.value), path, state);
    }

    return { present: false };
  }

  return walkSchema(schema.inner, value, path, state);
}

function walkString(
  schema: Extract<AnySchema, { kind: "string" }>,
  value: unknown,
  path: readonly string[],
  state: ValidationState
): WalkResult {
  if (typeof value !== "string") {
    addExpectedIssue(state, path, "string", value);
    return { present: true, value };
  }

  if (schema.minLength !== undefined && value.length < schema.minLength) {
    const expected = `string with length at least ${schema.minLength}`;
    addIssue(
      state,
      path,
      expected,
      `string with length ${value.length}`,
      `Expected ${expected} at ${formatPath(path)}`
    );
  }

  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    const expected = `string with length at most ${schema.maxLength}`;
    addIssue(
      state,
      path,
      expected,
      `string with length ${value.length}`,
      `Expected ${expected} at ${formatPath(path)}`
    );
  }

  if (schema.pattern !== undefined) {
    const pattern = compilePattern(schema.pattern);

    if (pattern === undefined || !pattern.test(value)) {
      const expected = `string matching pattern ${schema.pattern}`;
      addIssue(state, path, expected, value, `Expected ${expected} at ${formatPath(path)}`);
    }
  }

  return { present: true, value };
}

function walkNumber(
  schema: Extract<AnySchema, { kind: "number" }>,
  value: unknown,
  path: readonly string[],
  state: ValidationState
): WalkResult {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    addExpectedIssue(state, path, schema.jsonType === "integer" ? "integer" : "number", value);
    return { present: true, value };
  }

  if (schema.jsonType === "integer" && !Number.isInteger(value)) {
    addExpectedIssue(state, path, "integer", value);
  }

  if (schema.minimum !== undefined && value < schema.minimum) {
    const expected = `number greater than or equal to ${schema.minimum}`;
    addIssue(state, path, expected, String(value), `Expected ${expected} at ${formatPath(path)}`);
  }

  if (schema.maximum !== undefined && value > schema.maximum) {
    const expected = `number less than or equal to ${schema.maximum}`;
    addIssue(state, path, expected, String(value), `Expected ${expected} at ${formatPath(path)}`);
  }

  return { present: true, value };
}

function walkBoolean(value: unknown, path: readonly string[], state: ValidationState): WalkResult {
  if (typeof value !== "boolean") {
    addExpectedIssue(state, path, "boolean", value);
  }

  return { present: true, value };
}

function walkEnum(
  schema: Extract<AnySchema, { kind: "enum" }>,
  value: unknown,
  path: readonly string[],
  state: ValidationState
): WalkResult {
  if (!schema.values.includes(value as never)) {
    const expected = `one of ${schema.values.join(", ")}`;
    addIssue(
      state,
      path,
      expected,
      receivedValue(value),
      `Expected ${expected} at ${formatPath(path)}`
    );
  }

  return { present: true, value };
}

function walkArray(
  schema: Extract<AnySchema, { kind: "array" }>,
  value: unknown,
  path: readonly string[],
  state: ValidationState
): WalkResult {
  if (!Array.isArray(value)) {
    addExpectedIssue(state, path, "array", value);
    return { present: true, value };
  }

  if (schema.minItems !== undefined && value.length < schema.minItems) {
    const expected = `array with at least ${schema.minItems} items`;
    addIssue(
      state,
      path,
      expected,
      `array with ${value.length} items`,
      `Expected ${expected} at ${formatPath(path)}`
    );
  }

  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    const expected = `array with at most ${schema.maxItems} items`;
    addIssue(
      state,
      path,
      expected,
      `array with ${value.length} items`,
      `Expected ${expected} at ${formatPath(path)}`
    );
  }

  const nextValue = value.map((item, index) => {
    const result = walkSchema(schema.item, item, [...path, String(index)], state);

    return result.present ? result.value : item;
  });

  return { present: true, value: nextValue };
}

function walkObject(
  schema: ObjectSchema<any>,
  value: unknown,
  path: readonly string[],
  state: ValidationState,
  injectedProperties: Record<string, unknown> = {}
): WalkResult {
  if (!isPlainRecord(value)) {
    addExpectedIssue(state, path, "object", value);
    return { present: true, value };
  }

  const nextValue: Record<string, unknown> = {};
  const allowedKeys = new Set([...Object.keys(schema.shape), ...Object.keys(injectedProperties)]);

  for (const [key, propertySchema] of Object.entries(schema.shape) as Array<[string, AnySchema]>) {
    const propertyValue = Object.hasOwn(value, key) ? value[key] : missingValue;
    const result = walkSchema(propertySchema, propertyValue, [...path, key], state);

    if (result.present) {
      setOwnValue(nextValue, key, result.value);
    }
  }

  for (const [key, injectedValue] of Object.entries(injectedProperties)) {
    if (Object.hasOwn(value, key)) {
      setOwnValue(nextValue, key, value[key]);
    } else {
      setOwnValue(nextValue, key, injectedValue);
    }
  }

  for (const [key, propertyValue] of Object.entries(value)) {
    if (allowedKeys.has(key)) {
      continue;
    }

    if (schema.additionalProperties === true) {
      setOwnValue(nextValue, key, propertyValue);
    } else {
      addUnexpectedPropertyIssue(state, [...path, key]);
    }
  }

  return { present: true, value: nextValue };
}

function walkOneOf(
  schema: Extract<AnySchema, { kind: "oneOf" }>,
  value: unknown,
  path: readonly string[],
  state: ValidationState
): WalkResult {
  if (!isPlainRecord(value)) {
    addExpectedIssue(state, path, "object", value);
    return { present: true, value };
  }

  const discriminatorValue = value[schema.discriminator];
  const discriminatorPath = [...path, schema.discriminator];
  const branchValues = Object.keys(schema.branches);
  const expected = `one of ${branchValues.join(", ")}`;

  if (!Object.hasOwn(value, schema.discriminator)) {
    addIssueWithMessage(
      state,
      discriminatorPath,
      expected,
      "missing",
      `Missing discriminator "${schema.discriminator}" at ${formatPath(path)}. Expected one of: ${branchValues.join(", ")}.`
    );
    return { present: true, value };
  }

  if (
    typeof discriminatorValue !== "string" ||
    !Object.hasOwn(schema.branches, discriminatorValue)
  ) {
    addIssueWithMessage(
      state,
      discriminatorPath,
      expected,
      receivedValue(discriminatorValue),
      `Expected ${expected} at ${formatPath(discriminatorPath)}, got ${formatReceivedDiscriminator(discriminatorValue)}`
    );
    return { present: true, value };
  }

  return walkObject(schema.branches[discriminatorValue], value, path, state, {
    [schema.discriminator]: discriminatorValue
  });
}

function walkUnion(
  schema: Extract<AnySchema, { kind: "union" }>,
  value: unknown,
  path: readonly string[],
  state: ValidationState
): WalkResult {
  if (isPlainRecord(value)) {
    const candidateBranches = schema.branches.filter((branch) => hasRequiredKeys(branch, value));

    if (candidateBranches.length === 1) {
      return walkObject(candidateBranches[0], value, path, state);
    }
  }

  const matches: Array<{ fingerprint: string; value: unknown }> = [];

  for (const branch of schema.branches) {
    const branchState: ValidationState = { issues: [] };
    const result = walkObject(branch, value, path, branchState);

    if (branchState.issues.length === 0 && result.present) {
      matches.push({ fingerprint: getRequiredKeyFingerprint(branch), value: result.value });
    }
  }

  if (matches.length === 1) {
    return { present: true, value: matches[0].value };
  }

  if (matches.length === 0) {
    const branchDescriptions = schema.branches.map((branch) => getRequiredKeyFingerprint(branch));
    addIssueWithMessage(
      state,
      path,
      "exactly one union branch",
      "0 matching branches",
      `No union branch matched at ${formatPath(path)}. Tried ${schema.branches.length} branches. Expected one of: ${branchDescriptions.join(" | ")}.`
    );
    return { present: true, value };
  }

  addIssueWithMessage(
    state,
    path,
    "exactly one union branch",
    `${matches.length} matching branches`,
    `Expected exactly one union branch at ${formatPath(path)}, but matched more than one branch: ${matches.map((match) => match.fingerprint).join(" | ")}`
  );
  return { present: true, value };
}

function hasRequiredKeys(schema: ObjectSchema<any>, value: Record<string, unknown>): boolean {
  for (const [key, propertySchema] of Object.entries(schema.shape) as Array<[string, AnySchema]>) {
    if (propertySchema.kind !== "optional" && !Object.hasOwn(value, key)) {
      return false;
    }
  }

  return true;
}

function walkRecord(
  schema: Extract<AnySchema, { kind: "record" }>,
  value: unknown,
  path: readonly string[],
  state: ValidationState
): WalkResult {
  if (!isPlainRecord(value)) {
    addExpectedIssue(state, path, "object", value);
    return { present: true, value };
  }

  const nextValue: Record<string, unknown> = {};

  for (const [key, propertyValue] of Object.entries(value)) {
    const result = walkSchema(schema.value, propertyValue, [...path, key], state);

    if (result.present) {
      setOwnValue(nextValue, key, result.value);
    }
  }

  return { present: true, value: nextValue };
}

function walkJson(value: unknown, path: readonly string[], state: ValidationState): WalkResult {
  if (isJsonValue(value)) {
    return { present: true, value };
  }

  addExpectedIssue(state, path, "JSON value", value);
  return { present: true, value };
}

function getDefault(schema: AnySchema): WalkResult {
  if (schema.default !== undefined) {
    return { present: true, value: schema.default };
  }

  if (schema.kind === "optional") {
    return getDefault(schema.inner);
  }

  return { present: false };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value: unknown, ancestors: Set<object> = new Set()): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value !== "number" || Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return false;
    }
    ancestors.add(value);
    const result = value.every((item) => isJsonValue(item, ancestors));
    ancestors.delete(value);
    return result;
  }

  if (isPlainRecord(value)) {
    if (ancestors.has(value)) {
      return false;
    }
    ancestors.add(value);
    const result = Object.values(value).every((item) => isJsonValue(item, ancestors));
    ancestors.delete(value);
    return result;
  }

  return false;
}

function cloneDefault(value: unknown): unknown {
  return structuredClone(value);
}

function setOwnValue(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value
  });
}

function expectedFor(schema: AnySchema): string {
  switch (schema.kind) {
    case "string":
      return "string";
    case "number":
      return schema.jsonType === "integer" ? "integer" : "number";
    case "boolean":
      return "boolean";
    case "enum":
      return `one of ${schema.values.join(", ")}`;
    case "array":
      return "array";
    case "object":
    case "oneOf":
    case "record":
      return "object";
    case "union":
      return "exactly one union branch";
    case "json":
      return "JSON value";
    case "optional":
      return expectedFor(schema.inner);
  }
}

function addExpectedIssue(
  state: ValidationState,
  path: readonly string[],
  expected: string,
  value: unknown
): void {
  addIssue(
    state,
    path,
    expected,
    receivedType(value),
    `Expected ${expected} at ${formatPath(path)}`
  );
}

function addUnexpectedPropertyIssue(state: ValidationState, path: readonly string[]): void {
  addIssue(
    state,
    path,
    "no additional properties",
    "unknown property",
    `Unexpected property ${formatPath(path)}`
  );
}

function addIssue(
  state: ValidationState,
  path: readonly string[],
  expected: string,
  received: string,
  _message: string
): void {
  state.issues.push({
    path,
    expected,
    received,
    message: formatIssueMessage(expected, path, received)
  });
}

function addIssueWithMessage(
  state: ValidationState,
  path: readonly string[],
  expected: string,
  received: string,
  message: string
): void {
  state.issues.push({
    path,
    expected,
    received,
    message
  });
}

function formatIssueMessage(expected: string, path: readonly string[], received: string): string {
  return `Expected ${expected} at ${formatPath(path)}, got ${received}`;
}

function formatPath(path: readonly string[]): string {
  return path.length === 0 ? "value" : path.join(".");
}

function compilePattern(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

function receivedType(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (typeof value === "number" && Number.isInteger(value)) {
    return "integer";
  }

  return typeof value;
}

function receivedValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "undefined";
  }

  return String(value);
}

function formatReceivedDiscriminator(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  return receivedValue(value);
}
