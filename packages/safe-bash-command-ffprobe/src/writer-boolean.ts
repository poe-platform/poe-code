export function parseWriterBoolean(value: string): boolean {
  const lower = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(lower)) return true;
  if (["0", "false", "no", "off"].includes(lower)) return false;
  throw new Error(`Invalid writer boolean value: ${value}`);
}
