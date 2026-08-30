import { hostErrorData } from "../error/shape.js";

export type EnvModuleOptions = {
  allow: readonly string[];
  values?: Readonly<Record<string, string | undefined>>;
};

export type EnvModule = {
  get(name: string): string | undefined;
};

export class EnvAccessError extends Error {
  readonly code = "ENV_ACCESS_DENIED";
  readonly variable: string;

  constructor(variable: string) {
    super(`Environment access denied for ${JSON.stringify(variable)}.`);
    this.name = "EnvAccessError";
    this.variable = variable;
    hostErrorData.set(this, { code: this.code, variable });
  }
}

export function makeEnvModule(input: readonly string[] | EnvModuleOptions): EnvModule {
  const options = normalizeEnvOptions(Array.isArray(input) ? { allow: input } : input);
  const allowedNames = new Set(options.allow);
  const values = options.values;

  return {
    get(name) {
      const variable = readEnvName(name, "Environment variable name");
      if (!allowedNames.has(variable)) throw new EnvAccessError(variable);
      return readEnvValue(values ?? process.env, variable);
    }
  };
}

export function parseEnvConfig(json: string): EnvModuleOptions {
  return normalizeEnvOptions(JSON.parse(json));
}

function normalizeEnvOptions(input: unknown): EnvModuleOptions {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Environment options must be an object.");
  }
  const fields = Object.getOwnPropertyDescriptors(input);
  for (const key of Reflect.ownKeys(fields)) {
    if (key !== "allow" && key !== "values") {
      throw new TypeError("Unknown environment option.");
    }
    if (!("value" in fields[key]!)) {
      throw new TypeError("Environment options must not contain accessors.");
    }
  }
  const inputAllow: unknown = Object.getOwnPropertyDescriptor(input, "allow")?.value;
  if (!Array.isArray(inputAllow)) {
    throw new TypeError("Environment allow list must be an array of non-empty strings.");
  }
  const allow: string[] = [];
  for (let index = 0; index < inputAllow.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(inputAllow, index);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new TypeError("Environment allow list must contain only own data entries.");
    }
    allow.push(readEnvName(descriptor.value, `Environment allow list[${index}]`));
  }
  const inputValues: unknown = Object.getOwnPropertyDescriptor(input, "values")?.value;
  if (inputValues === undefined) return { allow };
  if (inputValues === null || typeof inputValues !== "object" || Array.isArray(inputValues)) {
    throw new TypeError("Environment values must be an object.");
  }
  return {
    allow,
    values: Object.fromEntries(allow.map((name) => [name, readEnvValue(inputValues, name)]))
  };
}

function readEnvValue(values: object, name: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(values, name);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Environment value for ${JSON.stringify(name)} must not be an accessor.`);
  }
  if (descriptor.value !== undefined && typeof descriptor.value !== "string") {
    throw new TypeError(
      `Environment value for ${JSON.stringify(name)} must be a string or undefined.`
    );
  }
  return descriptor.value as string | undefined;
}

function readEnvName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  if (value.includes("\0") || value.includes("=")) {
    throw new TypeError(`${label} must not contain NUL or equals signs.`);
  }
  return value;
}
