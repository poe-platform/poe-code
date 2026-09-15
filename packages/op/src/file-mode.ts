export function parseOpFileMode(value: unknown): number {
  if (value === undefined) return 0o600;
  if (typeof value !== "string" || value.length < 3) throw new Error("file-mode requires at least three octal digits");
  let mode = 0;
  for (const character of value) {
    if (character < "0" || character > "7") throw new Error("file-mode must be an octal permission mode");
    mode = mode * 8 + Number(character);
    if (mode > 0xffffffff) throw new Error("file-mode exceeds uint32 range");
  }
  return mode;
}
