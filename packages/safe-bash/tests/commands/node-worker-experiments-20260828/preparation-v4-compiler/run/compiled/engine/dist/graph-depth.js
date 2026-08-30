import { replaceErrorStack } from "./error/shape.js";
import { SandboxError } from "./interp/budget.js";
import { getSandboxArgumentEntries, isSandboxArguments } from "./interp/arguments.js";
export const MAX_DATA_DEPTH = 1_024;
export class SnapshotBudgetError extends Error {
    code = "budgetExceeded";
    budget = "dataDepth";
    current;
    limit;
    path;
    constructor(path, current, limit = MAX_DATA_DEPTH) {
        super(`Snapshot budget exceeded for dataDepth at ${path}: ${current} > ${limit}.`);
        this.name = "SnapshotBudgetError";
        this.current = current;
        this.limit = limit;
        this.path = path;
        replaceErrorStack(this);
    }
}
export function assertSandboxDataDepth(depth) {
    if (depth > MAX_DATA_DEPTH) {
        throw new SandboxError({ budget: "dataDepth", current: depth, limit: MAX_DATA_DEPTH });
    }
}
export function assertSnapshotDataDepth(depth, path) {
    if (depth > MAX_DATA_DEPTH)
        throw new SnapshotBudgetError(path, depth);
}
export function assertSnapshotGraphDepth(value, rootPath = "$") {
    walkGraphDepth(value, rootPath, (depth, path) => assertSnapshotDataDepth(depth, path));
}
export function assertSandboxGraphDepth(value) {
    walkGraphDepth(value, "<root>", (depth) => assertSandboxDataDepth(depth));
}
function walkGraphDepth(root, rootPath, assertDepth) {
    const ancestors = new WeakSet();
    const stack = [{ value: root, path: rootPath, depth: 0, exiting: false }];
    while (stack.length > 0) {
        const frame = stack.pop();
        if (typeof frame.value !== "object" || frame.value === null)
            continue;
        if (frame.exiting) {
            ancestors.delete(frame.value);
            continue;
        }
        assertDepth(frame.depth, frame.path);
        if (ancestors.has(frame.value))
            continue;
        ancestors.add(frame.value);
        stack.push({ ...frame, exiting: true });
        const entries = graphEntries(frame.value);
        for (let index = entries.length - 1; index >= 0; index -= 1) {
            const [key, entry] = entries[index];
            stack.push({
                value: entry,
                path: `${frame.path}${key}`,
                depth: frame.depth + 1,
                exiting: false
            });
        }
    }
}
function graphEntries(value) {
    if (isSandboxArguments(value)) {
        return getSandboxArgumentEntries(value).map(([key, entry]) => [`.${key}`, entry]);
    }
    if (Array.isArray(value))
        return value.map((entry, index) => [`[${index}]`, entry]);
    if (value instanceof Map) {
        return [...value.entries()].flatMap(([key, entry], index) => [
            [`.<map>[${index}].key`, key],
            [`.<map>[${index}].value`, entry]
        ]);
    }
    if (value instanceof Set) {
        return [...value.values()].map((entry, index) => [`.<set>[${index}]`, entry]);
    }
    const entries = [];
    for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor !== undefined && "value" in descriptor)
            entries.push([`.${key}`, descriptor.value]);
    }
    return entries;
}
