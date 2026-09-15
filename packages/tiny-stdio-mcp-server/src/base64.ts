export function isBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  return Buffer.from(value, "base64").toString("base64") === value;
}
