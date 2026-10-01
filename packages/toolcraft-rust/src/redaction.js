import { createRequire } from "node:module";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
export const { isSensitiveName, redactHttpHeaderValue } = native;

// These operations run caller code. Keeping them in JS preserves map species,
// sparse entries, custom methods and serializer exceptions without copying values.
const host = {
  serializer: protect((value) => value.toJSON),
  serialize: protect((hook, value, name) => hook.call(value, name)),
  entries: protect((value) => Object.entries(value)),
  fromEntries: protect((entries) => Object.fromEntries(entries)),
  map: protect((value, seen) =>
    value.map((entry, index) =>
      callNative(native.redactValue, entry, String(index), seen, true, host)
    )
  )
};

export function redactSecretLikeFields(value, name = "") {
  return callNative(native.redactValue, value, name, new WeakSet(), true, host);
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
