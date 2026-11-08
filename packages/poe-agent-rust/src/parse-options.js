export function toOptionsObject(input) {
  if (input === undefined || input === null) {
    return {};
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("expected an object");
  }
  return input;
}
export function rejectUnknownKeys(input, allowedKeys) {
  for (const key of Object.keys(input)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${key}: unknown option`);
    }
  }
}
export function readOptionalString(input, key) {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${key}: expected a string`);
  }
  return value;
}
export function readOptionalStringArray(input, key) {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${key}: expected an array of strings`);
  }
  return value;
}
export function readOptionalNonNegativeInteger(input, key) {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${key}: expected a non-negative integer`);
  }
  return value;
}
export function readRequiredEnum(input, key, allowedValues) {
  const value = input[key];
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    throw new Error(`${key}: expected one of ${allowedValues.join(", ")}`);
  }
  return value;
}
