import { createRequire } from "node:module";
import { text, typography } from "./text.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const thrown = new WeakMap();
const protect = operation => (...args) => {
  try { return operation(...args); }
  catch (value) {
    const carrier = new Error("Command diagnostic host operation failed");
    thrown.set(carrier, value);
    throw carrier;
  }
};
const operations = {
  flatten: value => value.replaceAll("\r\n", " ").replaceAll("\n", " ").replaceAll("\r", " "),
  positiveLength: value => value.length > 0,
  array: () => [],
  muted: value => text.muted(value),
  bold: value => typography.bold(value),
  command: value => text.command(value),
  usage: input => text.usageCommand(input.helpCommand),
  suggestions: (values, comma) => values.map(suggestion => text.command(suggestion)).join(text.muted(comma)),
  input: (unknownCommand, helpCommand, suggestions) => ({ unknownCommand, helpCommand, suggestions }),
  message: (label, hint) => ({ label, hint }),
  panel: (title, label, footer) => ({ title, label, footer })
};
const host = {
  get: protect((value, key) => value[key]),
  operate: protect((name, args) => operations[name](...args)),
  literal: value => value,
  stringify: protect(value => `${value}`)
};
let depth = 0;
function render(input, panel) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return native.designCommandError(input, panel, host); }
  catch (error) { if (thrown.has(error)) throw thrown.get(error); throw error; }
  finally { depth--; }
}
export function formatCommandNotFound(input) { return render(input, false); }
export function formatCommandNotFoundPanel(input) { return render(input, true); }
