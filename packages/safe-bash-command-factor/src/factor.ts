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

// Pollard rho batches GCDs while keeping every iteration charged and cancellable.
// Restarting the polynomial handles cycles that contain every factor at once.
async function splitComposite(value: bigint, budget: Budget): Promise<bigint> {
  for (let constant = 1n; ; constant++) {
    let slow = 2n, fast = 2n, batchSize = 64;
    for (let iteration = 0; iteration < 131072; iteration += batchSize) {
      const previousSlow = slow, previousFast = fast;
      let product = 1n;
      for (let step = 0; step < batchSize; step++) {
        budget.charge(4);
        slow = (slow * slow + constant) % value;
        fast = (fast * fast + constant) % value;
        fast = (fast * fast + constant) % value;
        product = product * (slow > fast ? slow - fast : fast - slow) % value;
        const checkpoint = budget.checkpointWork();
        if (checkpoint) await checkpoint;
      }
      let divisor = value, remainder = product;
      while (remainder !== 0n) {
        budget.charge();
        [divisor, remainder] = [remainder, divisor % remainder];
      }
      if (divisor === value) {
        if (batchSize === 1) break;
        // Replay this batch individually so small factors are not lost together.
        slow = previousSlow; fast = previousFast; batchSize = 1;
        continue;
      }
      if (divisor > 1n) return divisor;
    }
  }
}

async function collectFactors64(value: bigint, factors: bigint[], budget: Budget): Promise<void> {
  if (value === 1n) return;
  if (value === 2n || await prime64(value, budget)) {
    factors.push(value);
    return;
  }
  const divisor = value % 2n === 0n ? 2n : await splitComposite(value, budget);
  await collectFactors64(divisor, factors, budget);
  await collectFactors64(value / divisor, factors, budget);
}

function prime32Sync(n: number): boolean {
  if (n < 2) return false;
  if (n === 2 || n === 3 || n === 5 || n === 7) return true;
  if ((n & 1) === 0 || n % 3 === 0) return false;
  const bn = BigInt(n);
  let odd = bn - 1n;
  let powers = 0;
  while ((odd & 1n) === 0n) { odd >>= 1n; powers++; }
  for (const witness of [2n, 7n, 61n]) {
    if (bn <= witness) break;
    let base = witness % bn;
    if (base === 0n) continue;
    let exp = odd;
    let res = 1n;
    while (exp > 0n) {
      if ((exp & 1n) === 1n) res = (res * base) % bn;
      base = (base * base) % bn;
      exp >>= 1n;
    }
    if (res === 1n || res === bn - 1n) continue;
    let passed = false;
    for (let r = 1; r < powers; r++) {
      res = (res * res) % bn;
      if (res === bn - 1n) { passed = true; break; }
    }
    if (!passed) return false;
  }
  return true;
}

export async function factorRecord(value: bigint, budget: Budget, exponents: boolean): Promise<string> {
  let remaining = value;
  const factors: bigint[] = [];
  let retained = 512, checkPrime = true;
  const unlimitedWork = budget.limits.maxWork === Infinity;
  budget.retain(retained);
  try {
    for (let divisor = 2n; divisor * divisor <= remaining; divisor = divisor === 2n ? 3n : divisor + 2n) {
      if (checkPrime && unlimitedWork && remaining > 256n && remaining <= 4_294_967_295n && prime32Sync(Number(remaining))) {
        budget.charge(1024);
        { const cp = budget.checkpointWork(); if (cp) await cp; }
        break;
      }
      if (checkPrime && remaining > 4_294_967_295n && remaining < 1n << 64n) {
        // At most 64 prime factors and 64 recursion frames for a uint64 input.
        budget.retain(8192); retained += 8192;
        const tail: bigint[] = [];
        await collectFactors64(remaining, tail, budget);
        tail.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
        factors.push(...tail);
        remaining = 1n;
        break;
      }
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
