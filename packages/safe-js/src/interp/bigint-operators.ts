import { Budget, SandboxError } from "./budget.js";

export type BigIntOperator = "+" | "-" | "*" | "/" | "%" | "**" | "&" | "|" | "^" | "<<" | ">>" | ">>>";

export function bigIntOperation(operator: BigIntOperator, left: bigint, right: bigint, budget: Budget): bigint {
  if (operator === ">>>") throw new TypeError("BigInts have no unsigned right shift.");
  if ((operator === "/" || operator === "%") && right === 0n) throw new RangeError("Division by zero.");
  if (operator === "**" && right < 0n) throw new RangeError("BigInt exponent must be nonnegative.");
  const leftSize = left.toString(16).length;
  const rightSize = right.toString(16).length;
  budget.visitNode(leftSize + rightSize);
  let size = Math.max(leftSize, rightSize) + 1;
  let work = leftSize + rightSize;
  if (operator === "*") {
    size = leftSize + rightSize;
    work = leftSize * rightSize;
  } else if (operator === "/" || operator === "%") {
    size = leftSize;
    work = leftSize * rightSize;
  } else if (operator === "**") {
    if (right === 0n) return 1n;
    if (left === 0n || left === 1n) return left;
    if (left === -1n) return right % 2n === 0n ? 1n : -1n;
    size = leftSize * Number(right);
    work = size * size;
  } else if (operator === "<<" || operator === ">>") {
    if (left === 0n) return 0n;
    const shift = operator === "<<" ? right : -right;
    size = shift > 0n ? leftSize + Math.ceil(Number(shift) / 4) : leftSize;
    work = size + rightSize;
  }
  if (!Number.isSafeInteger(size) || !Number.isSafeInteger(work))
    throw new SandboxError({ budget: "dataSize", current: Infinity, limit: Number.MAX_SAFE_INTEGER });
  budget.visitNode(work);
  const allocation = {};
  budget.setRetainedDataUsage(allocation, size);
  try {
    switch (operator) {
      case "+": return left + right;
      case "-": return left - right;
      case "*": return left * right;
      case "/": return left / right;
      case "%": return left % right;
      case "**": return left ** right;
      case "&": return left & right;
      case "|": return left | right;
      case "^": return left ^ right;
      case "<<": return left << right;
      case ">>": return left >> right;
    }
  } finally { budget.setRetainedDataUsage(allocation, 0); }
}
