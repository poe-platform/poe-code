import { replaceErrorStack } from "./error/shape.js";
import { SandboxError } from "./interp/budget.js";
import { getSandboxArgumentEntries, isSandboxArguments } from "./interp/arguments.js";
import { collectionIteratorState, isSandboxCollectionIterator } from "./interp/collection-iterator.js";
import { isSandboxMap, isSandboxSet } from "./interp/collection-brands.js";
import { boxedDataProperties, isSandboxBox } from "./interp/boxed.js";
import { regexGuestProperties } from "./interp/regexp-properties.js";

export const MAX_DATA_DEPTH = 1_024;

export class SnapshotBudgetError extends Error {
  readonly code = "budgetExceeded";
  readonly budget = "dataDepth";
  readonly current: number;
  readonly limit: number;
  readonly path: string;

  constructor(path: string, current: number, limit = MAX_DATA_DEPTH) {
    super(`Snapshot budget exceeded for dataDepth at ${path}: ${current} > ${limit}.`);
    this.name = "SnapshotBudgetError";
    this.current = current;
    this.limit = limit;
    this.path = path;
    replaceErrorStack(this);
  }
}

export function assertSandboxDataDepth(depth: number): void {
  if (depth > MAX_DATA_DEPTH) {
    throw new SandboxError({ budget: "dataDepth", current: depth, limit: MAX_DATA_DEPTH });
  }
}

export function assertSnapshotDataDepth(depth: number, path: string): void {
  if (depth > MAX_DATA_DEPTH) throw new SnapshotBudgetError(path, depth);
}

export function assertSnapshotGraphDepth(value: unknown, rootPath = "$"): void {
  walkGraphDepth(value, rootPath, (depth, path) => assertSnapshotDataDepth(depth, path));
}

export function assertSandboxGraphDepth(value: unknown): void {
  walkGraphDepth(value, "<root>", (depth) => assertSandboxDataDepth(depth));
}

function walkGraphDepth(
  root: unknown,
  rootPath: string,
  assertDepth: (depth: number, path: string) => void
): void {
  type Frame = { value: unknown; path: string; depth: number; exiting: boolean };
  const ancestors = new WeakSet<object>();
  const stack: Frame[] = [{ value: root, path: rootPath, depth: 0, exiting: false }];

  while (stack.length > 0) {
    const frame = stack.pop() as Frame;
    if (typeof frame.value !== "object" || frame.value === null) continue;
    if (frame.exiting) {
      ancestors.delete(frame.value);
      continue;
    }
    assertDepth(frame.depth, frame.path);
    if (ancestors.has(frame.value)) continue;
    ancestors.add(frame.value);
    stack.push({ ...frame, exiting: true });

    const entries = graphEntries(frame.value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, entry] = entries[index] as [string, unknown];
      stack.push({
        value: entry,
        path: `${frame.path}${key}`,
        depth: frame.depth + 1,
        exiting: false
      });
    }
  }
}

function graphEntries(value: object): Array<[string, unknown]> {
  const properties = regexGuestProperties.get(value);
  if (properties !== undefined) return Reflect.ownKeys(properties).flatMap(key => {
    const descriptor = Object.getOwnPropertyDescriptor(properties, key)!;
    return "value" in descriptor ? [[`.${String(key)}`, descriptor.value] as [string, unknown]] : [];
  });
  if (isSandboxBox(value)) return boxedDataProperties(value).map(([key, descriptor]) => [`.${key}`, descriptor.value]);
  if (isSandboxArguments(value)) {
    return getSandboxArgumentEntries(value).map(([key, entry]) => [`.${key}`, entry]);
  }
  const map = isSandboxMap(value) ? value.entries : value instanceof Map ? value : undefined;
  if (map !== undefined) {
    return [...map.entries()].flatMap(([key, entry], index) => [
      [`.<map>[${index}].key`, key] as [string, unknown],
      [`.<map>[${index}].value`, entry] as [string, unknown]
    ]);
  }
  const set = isSandboxSet(value) ? value.values : value instanceof Set ? value : undefined;
  if (set !== undefined) {
    return [...set.values()].map((entry, index) => [`.<set>[${index}]`, entry]);
  }

  const entries: Array<[string, unknown]> = [];
  if (isSandboxCollectionIterator(value)) entries.push([".<collection>", collectionIteratorState(value).collection]);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor)
      entries.push([Array.isArray(value) ? `[${key}]` : `.${key}`, descriptor.value]);
  }
  return entries;
}
