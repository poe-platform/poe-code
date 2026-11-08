import { native } from "./native.js";
const isObject = (value) =>
  value !== null && (typeof value === "object" || typeof value === "function");
export function resolveApiShape(provider, agent) {
  if (!provider.apiShapes || !agent.apiShapes) return undefined;
  const iterator = agent.apiShapes[Symbol.iterator]();
  if (!isObject(iterator)) throw new TypeError("API shape iterator must be an object.");
  const next = iterator.next;
  let inBody = false;
  let result;
  try {
    result = native.providerResolveLive(
      () => {
        inBody = false;
        const step = Reflect.apply(next, iterator, []);
        if (!isObject(step)) throw new TypeError("API shape iterator result must be an object.");
        return step;
      },
      (shapeId) => {
        inBody = true;
        return Boolean(provider.apiShapes.some((shape) => shape.id === shapeId));
      }
    );
  } catch (error) {
    if (inBody) {
      try {
        const close = iterator.return;
        if (close != null) Reflect.apply(close, iterator, []);
      } catch {
        // IteratorClose preserves the original predicate failure.
      }
    }
    throw error;
  }
  if (result.found) {
    const close = iterator.return;
    if (close != null && !isObject(Reflect.apply(close, iterator, [])))
      throw new TypeError("API shape iterator return result must be an object.");
    return result.value;
  }
  return undefined;
}
