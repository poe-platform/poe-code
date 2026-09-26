import { Budget } from "./internal.js";

export async function parseNumber(input: string, budget: Budget): Promise<bigint | "invalid" | "large"> {
  let start = 0;
  while (input[start] === " ") { budget.charge(); start++; { const cp = budget.checkpointWork(); if (cp) await cp; } }
  if (input[start] === "+") start++;
  if (start === input.length) return "invalid";
  const maximum = budget.limits.maxValue === Infinity ? undefined : BigInt(budget.limits.maxValue);
  let result = 0n, large = false;
  for (let offset = start; offset < input.length; offset++) {
    budget.charge();
    const digit = input.charCodeAt(offset) - 48;
    if (digit < 0 || digit > 9) return "invalid";
    if (!large) {
      result = result * 10n + BigInt(digit);
      if (maximum !== undefined && result > maximum) large = true;
    }
    { const cp = budget.checkpointWork(); if (cp) await cp; }
  }
  return large ? "large" : result;
}

// These Miller–Rabin witnesses are deterministic for every unsigned 64-bit integer.
// Larger integers continue through exact trial division, without a magnitude cap.
async function prime64(value: bigint, budget: Budget): Promise<boolean> {
  if (value >= 1n << 64n || value % 2n === 0n) return false;
  let odd = value - 1n, powers = 0;
  while (odd % 2n === 0n) { odd /= 2n; powers++; budget.charge(); }
  for (const witness of [2n, 325n, 9375n, 28178n, 450775n, 9780504n, 1795265022n]) {
    let base = witness % value;
    if (base === 0n) continue;
    let exponent = odd, result = 1n;
    while (exponent > 0n) {
      budget.charge();
      if (exponent % 2n) result = result * base % value;
      base = base * base % value;
      exponent /= 2n;
      { const cp = budget.checkpointWork(); if (cp) await cp; }
    }
    if (result === 1n || result === value - 1n) continue;
    let passed = false;
    for (let power = 1; power < powers; power++) {
      budget.charge();
      result = result * result % value;
      { const cp = budget.checkpointWork(); if (cp) await cp; }
      if (result === value - 1n) { passed = true; break; }
    }
    if (!passed) return false;
  }
  return true;
}

export async function factorRecord(value: bigint, budget: Budget, exponents: boolean): Promise<string> {
  let remaining = value;
  const factors: bigint[] = [];
  let retained = 512, checkPrime = true;
  budget.retain(retained);
  try {
    for (let divisor = 2n; divisor * divisor <= remaining; divisor = divisor === 2n ? 3n : divisor + 2n) {
      if (checkPrime && remaining > 4_294_967_295n && await prime64(remaining, budget)) break;
      checkPrime = false;
      for (;;) {
        budget.charge();
        { const cp = budget.checkpointWork(); if (cp) await cp; }
        if (remaining % divisor !== 0n) break;
        budget.charge(2);
        budget.retain(16); retained += 16;
        factors.push(divisor);
        remaining /= divisor;
        checkPrime = true;
      }
    }
    if (remaining > 1n) factors.push(remaining);
    budget.charge(1 + factors.length * 11);
    let record = `${value}:`;
    for (let index = 0; index < factors.length; index++) {
      const factor = factors[index];
      let exponent = 1;
      if (exponents) {
        while (factors[index + 1] === factor) { exponent++; index++; }
      }
      const part = ` ${factor}${exponent > 1 ? `^${exponent}` : ""}`;
      budget.outputRoom(record.length + part.length + 1);
      budget.retain(part.length * 2); retained += part.length * 2;
      record += part;
    }
    return `${record}\n`;
  } finally { budget.retain(-retained); }
}
