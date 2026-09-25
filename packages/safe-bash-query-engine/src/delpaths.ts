import { Budget, copyObject, isObject, JqError, JqLimitError, put, remove, type Json } from "./limits.js";
import { isNumber, numberValue } from "./numbers.js";
import { indexValue, type } from "./values.js";

// Group against the original value so deleting one array element cannot shift
// any other requested path. An ancestor deletion subsumes its descendants.
async function deleteAt(input: Json, paths: Json[][], budget: Budget, depth: number): Promise<Json> {
  await budget.tick();
  if (depth > budget.limits.maxDepth) throw new JqLimitError("maxDepth");
  if (paths.some(path => path.length === depth)) return null;
  if (input === null || paths.length === 0) return input;
  if (!isObject(input) && !Array.isArray(input)) {
    const path = paths[0]!;
    if (path.length > depth + 1) indexValue(input, path[depth]!);
    throw new JqError(`Cannot delete fields from ${type(input)}`);
  }
  const groups = new Map<string | number, Json[][]>();
  for (const path of paths) {
    await budget.tick();
    const component = path[depth]!;
    const leaf = path.length === depth + 1;
    if (leaf) {
      if ((isObject(input) && typeof component !== "string") || (Array.isArray(input) && !isNumber(component))) {
        throw new JqError(`Cannot delete ${type(component)} ${Array.isArray(input) ? "element of array" : "field of object"}`);
      }
    } else indexValue(input, component);
    let key: string | number;
    if (typeof component === "string") key = component;
    else {
      if (!isNumber(component)) throw new JqError(`Cannot index ${type(input)} with ${type(component)}`);
      key = Math.trunc(numberValue(component));
      if (key < 0 && Array.isArray(input)) key += input.length;
    }
    if (Array.isArray(input) ? typeof key === "number" && (key < 0 || key >= input.length) : !Object.hasOwn(input, key)) continue;
    const group = groups.get(key) ?? [];
    budget.collection(group.length + 1);
    group.push(path);
    groups.set(key, group);
    budget.collection(groups.size);
  }
  if (Array.isArray(input)) {
    budget.collection(input.length);
    const result: Json[] = [];
    for (let index = 0; index < input.length; index++) {
      await budget.tick();
      const group = groups.get(index);
      if (group?.some(path => path.length === depth + 1)) continue;
      result.push(group ? await deleteAt(input[index]!, group, budget, depth + 1) : input[index]!);
    }
    return result;
  }
  const result = copyObject(input);
  for (const [key, group] of groups) {
    if (group.some(path => path.length === depth + 1)) remove(result, String(key));
    else put(result, String(key), await deleteAt(indexValue(input, key), group, budget, depth + 1));
  }
  return result;
}

export async function delpaths(input: Json, candidate: Json, budget: Budget): Promise<Json> {
  if (!Array.isArray(candidate)) throw new JqError("Paths must be specified as an array");
  const paths: Json[][] = [];
  for (const path of candidate) {
    await budget.tick();
    if (!Array.isArray(path)) throw new JqError(`Path must be specified as array, not ${type(path)}`);
    budget.collection(paths.length + 1);
    paths.push(path);
  }
  return deleteAt(input, paths, budget, 0);
}
