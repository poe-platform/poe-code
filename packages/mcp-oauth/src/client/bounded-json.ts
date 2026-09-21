/** Copy credential JSON without invoking accessors or custom serialization. */
export function copyBoundedOAuthJson(value: unknown, message: string): unknown {
  const invalid = () => new Error(message);
  let nodes = 0;
  function copy(input: unknown, depth: number): unknown {
    if (++nodes > 20_000 || depth > 64) throw invalid();
    if (input === null || typeof input === "boolean" || typeof input === "string") return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (typeof input !== "object" || input === null) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Array.isArray(input)) {
      const length = descriptors.length?.value as number;
      if (length > 20_000) throw invalid();
      const result: unknown[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) throw invalid();
        result.push(copy(descriptor.value, depth + 1));
      }
      return result;
    }
    if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) throw invalid();
    return Object.fromEntries(Object.entries(descriptors).filter(([, descriptor]) => descriptor.enumerable).map(([key, descriptor]) => {
      if (!Object.hasOwn(descriptor, "value")) throw invalid();
      return [key, copy(descriptor.value, depth + 1)];
    }));
  }
  let result: unknown;
  try { result = copy(value, 0); } catch { throw invalid(); }
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 64 * 1024) throw invalid();
  return result;
}
