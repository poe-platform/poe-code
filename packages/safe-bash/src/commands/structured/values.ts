import { Budget, copyObject, isObject, JqError, JqLimitError, objectKeyIterator, objectKeys, put, type Json } from "./limits.js";
import { compareNumbers, isNumber, numberValue, type Numeric } from "./numbers.js";
import { jsonFragments, renderJsonFragment } from "./input.js";

export function type(value: Json): string {
  return value === null ? "null" : isNumber(value) ? "number" : Array.isArray(value) ? "array" : typeof value;
}
export function describe(value: Json, budget: Budget): string {
  const parts: Uint8Array[] = [];
  let length = 0;
  for (const fragment of jsonFragments(value, budget)) {
    const text = renderJsonFragment(fragment, budget);
    budget.step(text.length);
    const bytes = Buffer.from(text);
    const retained = Math.min(15 - length, bytes.length);
    parts.push(bytes.subarray(0, retained));
    length += retained;
    if (length === 15) break;
  }
  const bytes = Buffer.concat(parts, length);
  const text = length < 15 ? bytes.toString() : `${bytes.subarray(0, 11).toString()}...`;
  return `${type(value)} (${text})`;
}
export async function stringCompare(left: string, right: string, budget: Budget): Promise<number> {
  await budget.tick(1 + Math.ceil(Math.min(left.length, right.length) / 32));
  let leftOffset = 0;
  let rightOffset = 0;
  let points = 0;
  while (leftOffset < left.length && rightOffset < right.length) {
    if (points++ % 32 === 0) await budget.tick(0);
    const leftPoint = left.codePointAt(leftOffset)!;
    const rightPoint = right.codePointAt(rightOffset)!;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftOffset += leftPoint > 0xffff ? 2 : 1;
    rightOffset += rightPoint > 0xffff ? 2 : 1;
  }
  return leftOffset < left.length ? 1 : rightOffset < right.length ? -1 : 0;
}
export async function stableSort<Item>(items: Item[], budget: Budget, comparator: (left: Item, right: Item) => Promise<number>): Promise<void> {
  await budget.tick(0);
  budget.collection(items.length);
  if (items.length < 2) return;
  await budget.tick(items.length);
  const scratch = new Array<Item>(items.length);
  let source = items;
  let target = scratch;
  for (let width = 1; width < items.length; width *= 2) {
    for (let start = 0; start < items.length; start += width * 2) {
      const middle = Math.min(start + width, items.length);
      const end = Math.min(start + width * 2, items.length);
      let left = start;
      let right = middle;
      for (let index = start; index < end; index++) {
        await budget.tick();
        if (left < middle && (right >= end || await comparator(source[left]!, source[right]!) <= 0)) target[index] = source[left++]!;
        else target[index] = source[right++]!;
      }
    }
    const previous = source;
    source = target;
    target = previous;
  }
  if (source !== items) for (let index = 0; index < items.length; index++) {
    await budget.tick();
    items[index] = source[index]!;
  }
}
export async function sortedKeys(value: Record<string, Json>, budget: Budget): Promise<string[]> {
  await budget.tick(0);
  const keys: string[] = [];
  for (const key of objectKeyIterator(value)) {
    await budget.tick();
    budget.collection(keys.length + 1);
    keys.push(key);
  }
  await stableSort(keys, budget, (left, right) => stringCompare(left, right, budget));
  return keys;
}
export async function compare(left: Json, right: Json, budget: Budget): Promise<number> {
  await budget.tick();
  const rank = (value: Json): number => value === null ? 0 : value === false ? 1 : value === true ? 2 : isNumber(value) ? 3 : typeof value === "string" ? 4 : Array.isArray(value) ? 5 : 6;
  const difference = rank(left) - rank(right);
  if (difference) return Math.sign(difference);
  if (isNumber(left) && isNumber(right)) return compareNumbers(left, right, budget);
  if (typeof left === "string" && typeof right === "string") return stringCompare(left, right, budget);
  if (left === right && !Array.isArray(left) && !isObject(left)) return 0;
  if (Array.isArray(left) && Array.isArray(right)) {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      const result = await compare(left[index]!, right[index]!, budget); if (result) return result;
    }
    return Math.sign(left.length - right.length);
  }
  if (isObject(left) && isObject(right)) {
    const keys = await sortedKeys(left, budget);
    const otherKeys = await sortedKeys(right, budget);
    const keyDifference = await compare(keys, otherKeys, budget);
    if (keyDifference) return keyDifference;
    for (const key of keys) { const result = await compare(left[key]!, right[key]!, budget); if (result) return result; }
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
export async function* entries(value: Json, budget: Budget): AsyncGenerator<[string | number, Json]> {
  budget.signal.throwIfAborted();
  if (Array.isArray(value)) {
    budget.collection(value.length);
    for (let index = 0; index < value.length; index++) {
      await budget.tick(2);
      yield [index, value[index]!];
    }
    return;
  }
  if (isObject(value)) {
    let count = 0;
    for (const key of objectKeyIterator(value)) {
      await budget.tick(2);
      budget.collection(++count);
      yield [key, value[key]!];
    }
    return;
  }
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
export async function binary(operator: string, left: Json, right: Json, budget: Budget): Promise<Json> {
  budget.step();
  if (["==", "!=", "<", "<=", ">", ">="].includes(operator)) {
    if (operator === "==") return equal(left, right, budget);
    if (operator === "!=") return !equal(left, right, budget);
    const order = await compare(left, right, budget);
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
      put(result, key, Object.hasOwn(left, key) && isObject(left[key]!) && isObject(value) ? await binary("*", left[key]!, value, budget) : value);
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
