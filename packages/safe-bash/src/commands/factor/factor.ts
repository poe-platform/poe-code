import { Budget } from "./internal.js";

export async function parseNumber(input: string, budget: Budget): Promise<number | "invalid" | "large"> {
  let start = 0;
  while (input[start] === " ") { budget.charge(); start++; await budget.checkpointWork(); }
  if (input[start] === "+") start++;
  if (start === input.length) return "invalid";
  let result = 0, large = false;
  for (let offset = start; offset < input.length; offset++) {
    budget.charge();
    const digit = input.charCodeAt(offset) - 48;
    if (digit < 0 || digit > 9) return "invalid";
    if (!large) {
      if (result > Math.floor((budget.limits.maxValue - digit) / 10)) large = true;
      else result = result * 10 + digit;
    }
    await budget.checkpointWork();
  }
  return large ? "large" : result;
}

export async function factorRecord(value: number, budget: Budget): Promise<string> {
  let remaining = value;
  const factors: number[] = [];
  budget.retain(512);
  try {
    for (let divisor = 2; divisor * divisor <= remaining; divisor = divisor === 2 ? 3 : divisor + 2) {
      for (;;) {
        budget.charge();
        await budget.checkpointWork();
        if (remaining % divisor !== 0) break;
        budget.charge(2);
        factors.push(divisor);
        remaining /= divisor;
      }
    }
    if (remaining > 1) factors.push(remaining);
    budget.charge(1 + factors.length * 11);
    return `${value}:${factors.map(factor => ` ${factor}`).join("")}\n`;
  } finally { budget.retain(-512); }
}
