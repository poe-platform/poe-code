export function validateBigIntData(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError("Invalid BigInt snapshot value.");
  if (value === "0") return;
  const start = value[0] === "-" ? 1 : 0;
  if (start === value.length || value[start] === "0") throw new TypeError("Invalid BigInt snapshot value.");
  for (let index = start; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) throw new TypeError("Invalid BigInt snapshot value.");
  }
}
