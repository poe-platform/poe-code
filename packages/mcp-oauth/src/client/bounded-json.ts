/** Copy credential JSON without invoking accessors or custom serialization. */
export function copyBoundedOAuthJson(value: unknown, message: string): unknown {
  const invalid = () => new Error(message);
  const ancestors = new Set<object>();
  const root: Record<string, unknown> = {};
  type Task = { input: unknown; target: object; key: string } | { leave: object };
  const tasks: Task[] = [{ input: value, target: root, key: "value" }];
  try {
    while (tasks.length) {
      const task = tasks.pop()!;
      if ("leave" in task) { ancestors.delete(task.leave); continue; }
      const { input, target, key } = task;
      let output: unknown = input;
      if (input !== null && typeof input !== "boolean" && typeof input !== "string" &&
          !(typeof input === "number" && Number.isFinite(input))) {
        if (typeof input !== "object" || input === null || ancestors.has(input)) throw invalid();
        const descriptors = Object.getOwnPropertyDescriptors(input);
        const array = Array.isArray(input);
        if (!array && Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) throw invalid();
        output = array ? [] : {};
        ancestors.add(input);
        tasks.push({ leave: input });
        const keys = array
          ? Array.from({ length: input.length }, (_, index) => String(index))
          : Object.keys(descriptors).filter(name => descriptors[name].enumerable);
        for (let index = keys.length - 1; index >= 0; index--) {
          const name = keys[index], descriptor = descriptors[name];
          if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) throw invalid();
          tasks.push({ input: descriptor.value, target: output as object, key: name });
        }
      }
      Object.defineProperty(target, key, { value: output, enumerable: true, configurable: true, writable: true });
    }
    return root.value;
  } catch { throw invalid(); }
}
