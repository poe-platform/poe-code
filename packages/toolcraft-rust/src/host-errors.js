const thrownValues = new WeakMap();

export function protect(operation) {
  return (...args) => {
    try {
      return operation(...args);
    } catch (value) {
      // napi-rs preserves Error identity but converts non-Error throws. Carry
      // arbitrary thrown values through an Error without stringifying them.
      const carrier = new Error("Toolcraft host operation failed");
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
