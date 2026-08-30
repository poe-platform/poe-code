export class UsageError extends Error {}

export interface Format {
  readonly unit: bigint;
  readonly suffix: string;
  readonly human?: 1000 | 1024;
}

export function blockSize(value: string): Format {
  if (value === "human-readable") return { unit: 1n, suffix: "", human: 1024 };
  if (value === "si") return { unit: 1n, suffix: "", human: 1000 };
  const match = /^(\d*)([kKmMGTPEZYRQ]?)(iB|B)?$/u.exec(value);
  if (!match || (!match[1] && !match[2]) || (match[3] && !match[2])) throw new UsageError(`invalid block size '${value}'`);
  const digits = match[1]!.replace(/^0+/u, "");
  if (digits.length > 16) throw new UsageError(`block size exceeds safe integer range '${value}'`);
  const multiplier = match[1] ? BigInt(digits || "0") : 1n;
  const power = match[2] ? "KMGTPEZYRQ".indexOf(match[2].toUpperCase()) + 1 : 0;
  const unit = multiplier * BigInt(match[3] === "B" ? 1000 : 1024) ** BigInt(power);
  if (unit < 1n || unit > BigInt(Number.MAX_SAFE_INTEGER)) throw new UsageError(`invalid or unsafe block size '${value}'`);
  let suffix = "";
  if (!match[1]) {
    suffix = match[2]!.toUpperCase();
    if (match[3] === "B") suffix = `${suffix === "K" ? "k" : suffix}B`;
    else if (match[3] === "iB") suffix += "iB";
  }
  return { unit, suffix };
}

function ceiling(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

export function formatSize(value: number, format: Format): string {
  const bytes = BigInt(value);
  if (!format.human) return `${ceiling(bytes, format.unit)}${format.suffix}`;
  const base = BigInt(format.human);
  let unit = 1n;
  let exponent = 0;
  while (bytes >= unit * base) { unit *= base; exponent++; }
  if (exponent === 0) return String(value);
  if (ceiling(bytes, unit) >= base) { unit *= base; exponent++; }
  const tenths = ceiling(bytes * 10n, unit);
  const number = tenths < 100n ? `${tenths / 10n}.${tenths % 10n}` : String(ceiling(bytes, unit));
  const suffix = (format.human === 1000 ? "kMGTPEZYRQ" : "KMGTPEZYRQ")[exponent - 1]!;
  return number + suffix;
}
