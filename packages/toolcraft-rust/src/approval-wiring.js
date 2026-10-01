import { createRequire } from "node:module";
import { UserError } from "./index.js";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
const hint = 'pass { humanInLoop: createHumanInLoop({ provider, ... }) } from "toolcraft/human-in-loop"';
let depth = 0;
function invoke(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(native.runtimePolicy, operation, args, host); }
  finally { depth--; }
}
const operations = {
  undefined: () => undefined,
  array: () => [],
  truthy: value => !!value,
  joinPath: path => path.join("."),
  unwired(path) { throw new UserError(`command '${path}' declares humanInLoop but no runtime is wired — ${hint}`); },
  missingRuntime() { throw new UserError(`approvals: true requires a wired humanInLoop runtime — ${hint}`); },
  invalidOperation() { throw new TypeError("Invalid runtime policy operation"); },
  mergeRoot: (runtime, root) => runtime.mergeApprovalsGroup(root),
  find: (node, path) => invoke("find", [node, path]),
  findChildren(children, path) {
    for (const child of children) {
      const found = invoke("find", [child, [...path, child.name]]);
      if (found !== undefined) return found;
    }
  }
};
const host = { operate: protect((name, args) => operations[name](...args)), get: protect((value, key) => value[key]) };

export function assertHumanInLoopWired(root, humanInLoop) {
  return invoke("assertWired", [root, humanInLoop]);
}

export function mergeApprovalsRoot(root, options) {
  return invoke("merge", [root, options]);
}
