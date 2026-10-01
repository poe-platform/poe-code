import { createRequire } from "node:module";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
export const { isSensitiveName, redactHttpHeaderValue } = native;

const thrownValues = new WeakMap();
function protect(operation) {
  return (...args) => {
    try {
      return operation(...args);
    } catch (value) {
      // napi-rs preserves Error identity but converts non-Error throws. Carry
      // arbitrary thrown values through an Error without stringifying them.
      const carrier = new Error("Redaction host operation failed");
      thrownValues.set(carrier, value);
      throw carrier;
    }
  };
}

function visit(value, name, seen) {
  try {
    return native.redactValue(value, name, seen, true, host);
  } catch (error) {
    if (thrownValues.has(error)) throw thrownValues.get(error);
    throw error;
  }
}

// These operations run caller code. Keeping them in JS preserves map species,
// sparse entries, custom methods and serializer exceptions without copying values.
const host = {
  serializer: protect((value) => value.toJSON),
  serialize: protect((hook, value, name) => hook.call(value, name)),
  entries: protect((value) => Object.entries(value)),
  fromEntries: protect((entries) => Object.fromEntries(entries)),
  map: protect((value, seen) => value.map((entry, index) => visit(entry, String(index), seen)))
};

export function redactSecretLikeFields(value, name = "") {
  return visit(value, name, new WeakSet());
}

export function redactHttpBody(body) {
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return body;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return body;
    }
    return redactSecretLikeFields(parsed);
  }
  return redactSecretLikeFields(body);
}
