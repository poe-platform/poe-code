import { Budget, copyObject, finite, isObject, JqError, JqLimitError, objectKeys, put, type Json } from "./limits.js";

export function type(value: Json): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}
export function stringCompare(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0)!);
  const rightPoints = Array.from(right, character => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index++) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! < rightPoints[index]! ? -1 : 1;
  }
  return Math.sign(leftPoints.length - rightPoints.length);
}
export function compare(left: Json, right: Json, budget: Budget): number {
  budget.step();
  const rank = (value: Json): number => value === null ? 0 : value === false ? 1 : value === true ? 2 : typeof value === "number" ? 3 : typeof value === "string" ? 4 : Array.isArray(value) ? 5 : 6;
  const difference = rank(left) - rank(right);
  if (difference) return Math.sign(difference);
  if (left === right) return 0;
  if (typeof left === "string" && typeof right === "string") return stringCompare(left, right);
  if (typeof left === "number" && typeof right === "number") return left < right ? -1 : 1;
  if (Array.isArray(left) && Array.isArray(right)) {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      const result = compare(left[index]!, right[index]!, budget); if (result) return result;
    }
    return Math.sign(left.length - right.length);
  }
  if (isObject(left) && isObject(right)) {
    const keys = objectKeys(left).sort(stringCompare);
    const otherKeys = objectKeys(right).sort(stringCompare);
    const keyDifference = compare(keys, otherKeys, budget);
    if (keyDifference) return keyDifference;
    for (const key of keys) { const result = compare(left[key]!, right[key]!, budget); if (result) return result; }
  }
  return 0;
}
export function entries(value: Json, budget: Budget): [string | number, Json][] {
  if (Array.isArray(value)) { budget.collection(value.length); return value.map((item, index) => [index, item]); }
  if (isObject(value)) { const keys = objectKeys(value); budget.collection(keys.length); return keys.map(key => [key, value[key]!]); }
  throw new JqError(`cannot iterate over ${type(value)}`);
}
export function indexValue(value: Json, index: Json): Json {
  if (typeof index === "string") {
    if (value === null) return null;
    if (isObject(value)) return Object.hasOwn(value, index) ? value[index]! : null;
  } else if (typeof index === "number" && Number.isFinite(index)) {
    if (value === null) return null;
    const integer = Math.trunc(index);
    if (Array.isArray(value)) return value[integer < 0 ? value.length + integer : integer] ?? null;
  }
  throw new JqError(`cannot index ${type(value)} with ${type(index)}`);
}
export function sliceValue(value: Json, start: Json, end: Json): Json {
  if (start !== null && (typeof start !== "number" || !Number.isSafeInteger(start))) throw new JqError("slice start must be an integer or null");
  if (end !== null && (typeof end !== "number" || !Number.isSafeInteger(end))) throw new JqError("slice end must be an integer or null");
  if (value === null) return null;
  if (Array.isArray(value)) return value.slice(start ?? 0, end ?? value.length);
  if (typeof value === "string") { const points = Array.from(value); return points.slice(start ?? 0, end ?? points.length).join(""); }
  throw new JqError(`cannot slice ${type(value)}`);
}
export function contains(value: Json, sought: Json, budget: Budget): boolean {
  budget.step();
  if (typeof value === "string" && typeof sought === "string") return value.includes(sought);
  if (Array.isArray(value) && Array.isArray(sought)) return sought.every(item => value.some(candidate => contains(candidate, item, budget)));
  if (isObject(value) && isObject(sought)) return objectKeys(sought).every(key => Object.hasOwn(value, key) && contains(value[key]!, sought[key]!, budget));
  return type(value) === type(sought) && compare(value, sought, budget) === 0;
}
export function binary(operator: string, left: Json, right: Json, budget: Budget): Json {
  budget.step();
  if (["==", "!=", "<", "<=", ">", ">="].includes(operator)) {
    const order = compare(left, right, budget);
    switch (operator) {
      case "==": return order === 0;
      case "!=": return order !== 0;
      case "<": return order < 0;
      case "<=": return order <= 0;
      case ">": return order > 0;
      default: return order >= 0;
    }
  }
  if (operator === "+") {
    if (left === null) return right;
    if (right === null) return left;
    if (typeof left === "number" && typeof right === "number") return finite(left + right);
    if (typeof left === "string" && typeof right === "string") { budget.text(left + right); return left + right; }
    if (Array.isArray(left) && Array.isArray(right)) { budget.collection(left.length + right.length); return [...left, ...right]; }
    if (isObject(left) && isObject(right)) { const result = copyObject(left, right); budget.collection(objectKeys(result).length); return result; }
  }
  if (operator === "-" && Array.isArray(left) && Array.isArray(right)) return left.filter(item => !right.some(other => compare(item, other, budget) === 0));
  if (operator === "*" && isObject(left) && isObject(right)) {
    const result = copyObject(left);
    for (const key of objectKeys(right)) {
      const value = right[key]!;
      put(result, key, Object.hasOwn(left, key) && isObject(left[key]!) && isObject(value) ? binary("*", left[key]!, value, budget) : value);
    }
    budget.collection(objectKeys(result).length); return result;
  }
  if (operator === "*" && ((typeof left === "string" && typeof right === "number") || (typeof right === "string" && typeof left === "number"))) {
    const text = typeof left === "string" ? left : right as string;
    const count = typeof left === "number" ? left : right as number;
    if (count < 0) return null;
    if (text === "") return "";
    if (Buffer.byteLength(text) * Math.floor(count) > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
    const result = text.repeat(Math.floor(count)); budget.text(result); return result;
  }
  if (operator === "/" && typeof left === "string" && typeof right === "string") {
    const result = right === "" ? Array.from(left) : left.split(right); budget.collection(result.length); return result;
  }
  if (typeof left === "number" && typeof right === "number") {
    if ((operator === "/" && right === 0) || (operator === "%" && Math.trunc(right) === 0)) throw new JqError("division by zero");
    if (operator === "-") return finite(left - right);
    if (operator === "*") return finite(left * right);
    if (operator === "/") return finite(left / right);
    if (operator === "%") return finite(Math.trunc(left) % Math.trunc(right));
  }
  throw new JqError(`cannot apply ${operator} to ${type(left)} and ${type(right)}`);
}
