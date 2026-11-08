/** Validate caller control data without invoking getters or serialization hooks. */
export function validateJsonData(value: unknown, message: string): void {
  const ancestors = new Set<object>();
  function visit(value: unknown): void {
    const fail = (): never => {
      throw new TypeError(message);
    };
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      return;
    if (!value || typeof value !== "object" || ancestors.has(value)) return fail();
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      return fail();
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) {
          const property = Object.getOwnPropertyDescriptor(value, index);
          if (!property || !("value" in property)) return fail();
          visit(property.value);
        }
      } else
        for (const name in value)
          if (Object.hasOwn(value, name)) {
            const property = Object.getOwnPropertyDescriptor(value, name)!;
            if (!("value" in property)) return fail();
            visit(property.value);
          }
    } finally {
      ancestors.delete(value);
    }
  }
  visit(value);
}
