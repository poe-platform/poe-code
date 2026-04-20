export const TOOL_NAME_PATTERN: RegExp = /^[a-zA-Z0-9_-]+$/;

export class InvalidToolNameError extends Error {
  constructor(name: string, contributor?: string) {
    super(
      contributor === undefined
        ? `Invalid tool name "${name}". Tool names must match ${TOOL_NAME_PATTERN}.`
        : `Invalid tool name "${name}" from ${contributor}. Tool names must match ${TOOL_NAME_PATTERN}.`,
    );
    this.name = "InvalidToolNameError";
  }
}

export function assertValidToolName(name: string, contributor?: string): void {
  if (name.length > 0 && TOOL_NAME_PATTERN.test(name)) {
    return;
  }

  throw new InvalidToolNameError(name, contributor);
}
