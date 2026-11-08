export const jsonOptionDescription =
  "Print machine-readable JSON to stdout instead of human-readable output.";

export interface JsonCommandOptions {
  json?: boolean;
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
