const thrown = new WeakMap();
const protect = operation => (...args) => {
  try { return operation(...args); }
  catch (value) {
    const carrier = new Error("Component host operation failed");
    thrown.set(carrier, value);
    throw carrier;
  }
};

export function createComponentPolicy(policy, operations) {
  const host = {
    get: protect((value, key) => value[key]),
    operate: protect((name, args) => operations[name](...args))
  };
  let depth = 0;
  return function invoke(operation, args) {
    if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
    depth++;
    try { return policy(operation, args, host); }
    catch (error) { if (thrown.has(error)) throw thrown.get(error); throw error; }
    finally { depth--; }
  };
}
