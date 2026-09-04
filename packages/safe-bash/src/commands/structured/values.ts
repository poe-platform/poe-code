import { Budget, copyObject, isObject, JqError, JqLimitError, objectKeys, put, type Json } from "./limits.js";
import { compareNumbers, isNumber, numberValue, type Numeric } from "./numbers.js";
import { stringify } from "./input.js";

export function type(value: Json): string {
  return value === null ? "null" : isNumber(value) ? "number" : Array.isArray(value) ? "array" : typeof value;
}
export function describe(value: Json, budget: Budget): string {
  const bytes = Buffer.from(stringify(value, budget));
  const text = bytes.length < 15 ? bytes.toString() : `${bytes.subarray(0, 11).toString()}...`;
  return `${type(value)} (${text})`;
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
  const rank = (value: Json): number => value === null ? 0 : value === false ? 1 : value === true ? 2 : isNumber(value) ? 3 : typeof value === "string" ? 4 : Array.isArray(value) ? 5 : 6;
  const difference = rank(left) - rank(right);
  if (difference) return Math.sign(difference);
  if (isNumber(left) && isNumber(right)) return compareNumbers(left, right, budget);
  if (left === right && !Array.isArray(left) && !isObject(left)) return 0;
  if (typeof left === "string" && typeof right === "string") return stringCompare(left, right);
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
export function equal(left: Json, right: Json, budget: Budget): boolean {
  budget.step();
  if (left === right) return true;
  if (isNumber(left) && isNumber(right)) return compareNumbers(left, right, budget) === 0;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => equal(value, right[index]!, budget));
  if (isObject(left) && isObject(right)) {
    const keys = objectKeys(left);
    return keys.length === objectKeys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key]!, right[key]!, budget));
  }
  return false;
}
export function entries(value: Json, budget: Budget): [string | number, Json][] {
  if (Array.isArray(value)) { budget.collection(value.length); return value.map((item, index) => [index, item]); }
  if (isObject(value)) { const keys = objectKeys(value); budget.collection(keys.length); return keys.map(key => [key, value[key]!]); }
  throw new JqError(`Cannot iterate over ${describe(value, budget)}`);
}
export function indexValue(value: Json, index: Json): Json {
  if (typeof index === "string") {
    if (value === null) return null;
    if (isObject(value)) return Object.hasOwn(value, index) ? value[index]! : null;
  } else if (isNumber(index) && Number.isFinite(numberValue(index))) {
    if (value === null) return null;
    const integer = Math.trunc(numberValue(index));
    if (Array.isArray(value)) return value[integer < 0 ? value.length + integer : integer] ?? null;
  }
  throw new JqError(`Cannot index ${type(value)} with ${type(index)}${typeof index === "string" && Buffer.byteLength(index) < 30 ? ` ${JSON.stringify(index)}` : ""}`);
}
export async function sliceValue(value: Json, start: Json, end: Json, budget: Budget): Promise<Json> {
  if (start !== null && (!isNumber(start) || !Number.isSafeInteger(numberValue(start)))) throw new JqError("slice start must be an integer or null");
  if (end !== null && (!isNumber(end) || !Number.isSafeInteger(numberValue(end)))) throw new JqError("slice end must be an integer or null");
  budget.signal.throwIfAborted();
  let first = start === null ? 0 : numberValue(start);
  let last = end === null ? undefined : numberValue(end);
  if (value === null) return null;
  if (Array.isArray(value)) return value.slice(first, last);
  if (typeof value !== "string") throw new JqError(`cannot slice ${type(value)}`);
  if (last === 0 || (last !== undefined && (first < 0) === (last < 0) && first >= last)) return "";
  if (first < 0 || (last !== undefined && last < 0)) {
    let length = 0;
    for (let offset = 0; offset < value.length; length++) {
      await budget.tick();
      offset += value.codePointAt(offset)! > 0xffff ? 2 : 1;
    }
    if (first < 0) first = Math.max(0, length + first);
    if (last !== undefined && last < 0) last = Math.max(0, length + last);
    if (last !== undefined && first >= last) return "";
  }
  let firstOffset = first === 0 ? 0 : value.length;
  let offset = 0;
  const stop = last ?? first;
  for (let point = 0; point < stop && offset < value.length;) {
    await budget.tick();
    offset += value.codePointAt(offset)! > 0xffff ? 2 : 1;
    if (++point === first) firstOffset = offset;
  }
  return value.slice(firstOffset, last === undefined ? undefined : offset);
}
export function contains(value: Json, sought: Json, budget: Budget): boolean {
  budget.step();
  if (typeof value === "string" && typeof sought === "string") return value.includes(sought);
  if (Array.isArray(value) && Array.isArray(sought)) return sought.every(item => value.some(candidate => contains(candidate, item, budget)));
  if (isObject(value) && isObject(sought)) return objectKeys(sought).every(key => Object.hasOwn(value, key) && contains(value[key]!, sought[key]!, budget));
  return type(value) === type(sought) && equal(value, sought, budget);
}
export function binary(operator: string, left: Json, right: Json, budget: Budget): Json {
  budget.step();
  if (["==", "!=", "<", "<=", ">", ">="].includes(operator)) {
    if (operator === "==") return equal(left, right, budget);
    if (operator === "!=") return !equal(left, right, budget);
    const order = compare(left, right, budget);
    switch (operator) {
      case "<": return order < 0;
      case "<=": return order <= 0;
      case ">": return order > 0;
      default: return order >= 0;
    }
  }
  if (operator === "+") {
    if (left === null) return right;
    if (right === null) return left;
    if (isNumber(left) && isNumber(right)) return numberValue(left) + numberValue(right);
    if (typeof left === "string" && typeof right === "string") {
      budget.step(left.length + right.length);
      const result = left + right;
      budget.text(result); return result;
    }
    if (Array.isArray(left) && Array.isArray(right)) { budget.collection(left.length + right.length); return [...left, ...right]; }
    if (isObject(left) && isObject(right)) { const result = copyObject(left, right); budget.collection(objectKeys(result).length); return result; }
  }
  if (operator === "-" && Array.isArray(left) && Array.isArray(right)) return left.filter(item => !right.some(other => equal(item, other, budget)));
  if (operator === "*" && isObject(left) && isObject(right)) {
    const result = copyObject(left);
    for (const key of objectKeys(right)) {
      const value = right[key]!;
      put(result, key, Object.hasOwn(left, key) && isObject(left[key]!) && isObject(value) ? binary("*", left[key]!, value, budget) : value);
    }
    budget.collection(objectKeys(result).length); return result;
  }
  if (operator === "*" && ((typeof left === "string" && isNumber(right)) || (typeof right === "string" && isNumber(left)))) {
    const text = typeof left === "string" ? left : right as string;
    const count = numberValue(isNumber(left) ? left : right as Numeric);
    if (count < 0) return null;
    if (text === "") return "";
    if (!Number.isFinite(count) || Buffer.byteLength(text) * Math.floor(count) > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
    const result = text.repeat(Math.floor(count)); budget.text(result); return result;
  }
  if (operator === "/" && typeof left === "string" && typeof right === "string") {
    const result = right === "" ? Array.from(left) : left.split(right); budget.collection(result.length); return result;
  }
  if (isNumber(left) && isNumber(right)) {
    const first = numberValue(left);
    const second = numberValue(right);
    if (operator === "%" && (Number.isNaN(first) || Number.isNaN(second))) return NaN;
    if ((operator === "/" && second === 0) || (operator === "%" && Math.trunc(second) === 0)) throw new JqError(`${describe(left, budget)} and ${describe(right, budget)} cannot be divided${operator === "%" ? " (remainder)" : ""} because the divisor is zero`);
    if (operator === "-") return first - second;
    if (operator === "*") return first * second;
    if (operator === "/") return first / second;
    if (operator === "%") {
      const integer = (value: number): bigint => value >= 2 ** 63 ? 9223372036854775807n : value <= -(2 ** 63) ? -9223372036854775808n : BigInt(Math.trunc(value));
      return Number(integer(first) % integer(second));
    }
  }
  if (operator === "+") throw new JqError(`${describe(left, budget)} and ${describe(right, budget)} cannot be added`);
  if (operator === "-") throw new JqError(`${describe(left, budget)} and ${describe(right, budget)} cannot be subtracted`);
  throw new JqError(`cannot apply ${operator} to ${type(left)} and ${type(right)}`);
}
