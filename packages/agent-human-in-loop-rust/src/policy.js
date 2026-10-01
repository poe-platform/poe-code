import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./agent-human-in-loop-rust.node");
const thrown = new WeakMap();
const protect = operation => (...args) => {
  try { return operation(...args); }
  catch (value) {
    const carrier = new Error("Approval host operation failed");
    thrown.set(carrier, value);
    throw carrier;
  }
};
let depth = 0;
export function policy(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return native.approvalPolicy(operation, args, host); }
  catch (error) { if (thrown.has(error)) throw thrown.get(error); throw error; }
  finally { depth--; }
}
const operations = {
  string: value => typeof value === "string",
  blank: value => value.trim().length === 0,
  objectRecord: value => typeof value === "object" && value !== null && !Array.isArray(value),
  ownOutcome: value => Object.prototype.hasOwnProperty.call(value, "outcome") ? value.outcome : undefined,
  ownReason: value => Object.prototype.hasOwnProperty.call(value, "reason") ? value.reason : undefined,
  requestMessage: message => ({ message }),
  requestPrompt: (message, declineInputPrompt) => ({ message, declineInputPrompt }),
  approved: () => ({ outcome: "approved" }),
  declined: () => ({ outcome: "declined" }),
  declinedReason: reason => ({ outcome: "declined", reason }),
  defaultTitle: () => "Approval needed",
  defaultBinary: () => "osascript",
  options: (title, binary) => ({ title, binary }),
  escapeSlashes: value => value.replace(/\\/g, "\\\\"),
  escapeQuotes: value => value.replace(/"/g, '\\"'),
  singleScript: (message, title) => `button returned of (display dialog "${message}" with title "${title}" buttons {"Decline","Approve"} default button "Approve")`,
  reasonScript: (message, title, prompt) => `set firstResp to button returned of (display dialog "${message}" with title "${title}" buttons {"Decline","Approve"} default button "Approve")
if firstResp is "Approve" then
  return "APPROVED"
end if
try
  set reason to text returned of (display dialog "${prompt}" default answer "" with title "${title}" buttons {"Cancel","Submit"} default button "Submit")
  return "DECLINED:" & reason
on error number -128
  return "DECLINED:"
end try`,
  endsCrlf: value => !!value.endsWith("\r\n"),
  endsLf: value => !!value.endsWith("\n"),
  endsCr: value => !!value.endsWith("\r"),
  trimOne: value => value.slice(0, -1),
  trimTwo: value => value.slice(0, -2),
  declinePrefix: value => !!value.startsWith("DECLINED:"),
  reasonSuffix: value => value.slice("DECLINED:".length),
  errorMessage: error => error instanceof Error ? error.message : error === undefined ? "" : String(error),
  optionalStderr: error => error?.stderr ?? "",
  cancelled: (message, stderr) => [message, stderr].some(value => value.includes("User canceled. (-128)")),
  missingBinary: error => typeof error === "object" && error !== null && Object.prototype.hasOwnProperty.call(error, "code") && error.code === "ENOENT",
  toString: String,
  blankMessage() { throw new Error("Approval request message must not be blank"); },
  invalidPrompt() { throw new Error("Approval request declineInputPrompt must be a string"); },
  invalidResult() { throw new Error("Approval provider returned an invalid result"); },
  binaryNotFound() { throw new Error("osascript not found — provide a different provider on this platform"); },
  failed(stderr) { throw new Error(`osascript failed: ${stderr.trim()}`); },
  unexpected(out) { throw new Error(`unexpected osascript output: ${out}`); },
  invalidOperation() { throw new TypeError("Invalid approval provider operation"); }
};
const host = {
  operate: protect((name, args) => operations[name](...args)),
  get: protect((value, key) => value[key])
};
