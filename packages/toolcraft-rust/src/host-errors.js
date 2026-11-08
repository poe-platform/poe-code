const thrownValues = new WeakMap();

export function protect(operation) {
  return (...args) => {
    try {
      return operation(...args);
    } catch (value) {
      // napi-rs preserves Error identity but converts non-Error throws. Carry
      // arbitrary thrown values through an Error without stringifying them.
      // napi-rs inspects .cause while converting exceptions. Shadow inherited
      // causes so a polluted prototype cannot introduce getters or a cycle.
      const carrier = new Error("Toolcraft host operation failed", { cause: undefined });
      thrownValues.set(carrier, value);
      throw carrier;
    }
  };
}

export function callNative(operation, ...args) {
  try {
    return operation(...args);
  } catch (error) {
    if (thrownValues.has(error)) throw thrownValues.get(error);
    throw error;
  }
}
