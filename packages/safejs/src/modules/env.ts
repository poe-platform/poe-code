export function makeEnvModule(allowList: readonly string[]): {
  get(name: string): string | undefined;
} {
  const allowedNames = normalizeAllowList(allowList);

  return {
    get(name) {
      const normalizedName = readNonEmptyString(name, "Environment variable name");

      if (!allowedNames.has(normalizedName)) {
        return undefined;
      }

      return process.env[normalizedName];
    }
  };
}

function normalizeAllowList(allowList: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(allowList)) {
    throw new Error("Environment allow list must be an array of non-empty strings.");
  }

  return new Set(
    allowList.map((entry, index) => readNonEmptyString(entry, `Environment allow list[${index}]`))
  );
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}
