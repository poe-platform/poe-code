export class HarnessFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessFailure";
  }
}

export function makeFailModule(): {
  default: (message: string) => never;
} {
  function fail(message: string): never {
    throw new HarnessFailure(readNonEmptyString(message, "Harness failure message"));
  }

  return {
    default: fail
  };
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a non-empty string.`);
  }

  if (value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}
