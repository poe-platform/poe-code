export interface EnvironmentSnapshot {
  readonly version: 1;
  readonly scope: "complete" | "selected";
  readonly variables: Readonly<Record<string, string | null>>;
}

function variableEntries(value: unknown, allowUnset: boolean): [string, string | null][] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid environment variables");
  const entries: [string, string | null][] = [];
  for (const name of Reflect.ownKeys(value)) {
    if (typeof name !== "string" || !name || name.includes("=") || name.includes("\0")) throw new Error("Invalid environment variable name");
    const descriptor = Object.getOwnPropertyDescriptor(value, name)!;
    if (!Object.hasOwn(descriptor, "value")) throw new Error("Environment variables must be data properties");
    const content: unknown = descriptor.value;
    if (content === undefined || (allowUnset && content === null)) {
      if (allowUnset) entries.push([name, null]);
      continue;
    }
    if (typeof content !== "string" || content.includes("\0")) throw new Error("Invalid environment variable value");
    entries.push([name, content]);
  }
  return entries;
}

export function captureEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  options: { readonly names?: readonly string[] } = {},
): EnvironmentSnapshot {
  const entries = new Map(variableEntries(environment, false));
  let captured = [...entries];
  if (options.names !== undefined) {
    captured = [...new Set(options.names)].map(name => [name, entries.get(name) ?? null]);
    variableEntries(Object.fromEntries(captured), true);
  }
  return Object.freeze({
    version: 1,
    scope: options.names === undefined ? "complete" : "selected",
    variables: Object.freeze(Object.fromEntries(captured)),
  });
}

export function restoreEnvironment(
  snapshot: unknown,
  current: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("Invalid environment snapshot");
  const descriptors = Object.getOwnPropertyDescriptors(snapshot);
  const version = descriptors.version?.value;
  const scope = descriptors.scope?.value;
  if (version !== 1 || (scope !== "complete" && scope !== "selected") || !Object.hasOwn(descriptors.variables ?? {}, "value")) {
    throw new Error("Invalid environment snapshot");
  }
  const variables = variableEntries(descriptors.variables.value, true);
  const result = new Map(scope === "selected" ? variableEntries(current, false) : []);
  for (const [name, value] of variables) {
    if (value === null) result.delete(name);
    else result.set(name, value);
  }
  return Object.fromEntries(result) as Record<string, string>;
}
