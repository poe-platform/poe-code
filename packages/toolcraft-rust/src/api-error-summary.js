import { createRequire } from "node:module";
import { redactHttpBody } from "./redaction.js";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
let depth = 0;
function invoke(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(native.apiErrorSummary, operation, args, host); }
  finally { depth--; }
}
const operations = {
  undefined: () => undefined,
  true: () => true,
  false: () => false,
  empty: () => [],
  object: value => typeof value === "object" && value !== null && !Array.isArray(value),
  string: value => typeof value === "string",
  number: value => typeof value === "number",
  array: Array.isArray,
  values: Object.values,
  ownBody: value => Object.prototype.hasOwnProperty.call(value, "body"),
  allStrings: value => !!value.every(entry => typeof entry === "string"),
  positiveLength: value => value.length > 0,
  zeroLength: value => value.length === 0,
  lower: value => value.toLowerCase(),
  first: value => { const [first] = value; return first; },
  redact: redactHttpBody,
  requestHeader: () => "x-request-id",
  retryHeader: () => "retry-after",
  findHeader(headers, name) {
    for (const [key, value] of Object.entries(headers)) {
      const found = invoke("header", [key, value, name]);
      if (found !== undefined) return found;
    }
  },
  summaryFields: error => ({ status: error.response.status, statusText: error.response.statusText, requestMethod: error.request.method, requestUrl: error.request.url }),
  envelopeBase: message => ({ kind: "http", message }),
  httpFields: summary => ({ method: summary.requestMethod, url: summary.requestUrl, status: summary.status, statusText: summary.statusText }),
  candidates: body => [body.field_errors, body.fieldErrors, body.errors, body.non_field_errors],
  flattenCandidates: candidates => candidates.flatMap(candidate => invoke("flatten", [candidate, []])),
  field: (path, message) => [{ path: path.length === 0 ? "error" : path.join("."), message }],
  stringFields: (value, path) => value.map(message => ({ path: path.length === 0 ? "error" : path.join("."), message })),
  arrayFields: (value, path) => value.flatMap((entry, index) => invoke("flatten", [entry, [...path, String(index)]])),
  objectFields: (value, path) => Object.entries(value).flatMap(([key, nested]) => invoke("flatten", [nested, [...path, key]])),
  equals401: value => value === 401,
  equals403: value => value === 403,
  equals429: value => value === 429,
  equals503: value => value === 503,
  authHint: () => "Check the configured API credentials and permissions.",
  retryHint: value => `Retry after ${value}.`,
  invalidOperation() { throw new TypeError("Invalid API error summary operation"); }
};
const host = {
  operate: protect((name, args) => name.startsWith("set:")
    ? Object.defineProperty(args[0], name.slice(4), { value: args[1], enumerable: true, writable: true, configurable: true })
    : operations[name](...args)),
  get: protect((value, key) => value[key])
};

export function isHttpErrorLike(error) { return invoke("recognize", [error]); }
export function summarizeHttpError(error) { return invoke("summary", [error]); }
export function createHttpErrorEnvelope(error, reportPath) { return invoke("envelope", [error, reportPath]); }
