import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const defaults = native.designDashboardKeymapDefaults();
const commands = defaults.map(([command]) => command);
const defaultBindings = Object.fromEntries(defaults.map(([command, ...keys]) => [command, keys]));
const namedKeys = new Set(native.designDashboardNamedKeys());
function parseBinding(binding) {return invoke("parse", [binding]);}
const invoke = createComponentPolicy(native.designDashboardKeymapPolicy, {
  true: () => true, false: () => false, undefined: () => undefined, truthy: value => !!value, nullish: value => value == null,
  same: (a, b) => a === b, lt: (a, b) => a < b,
  trim: value => value.trim(), lower: value => value.toLowerCase(), upper: value => value.toUpperCase(),
  parts: value => value.split("+").map(part => part.trim()).filter(Boolean), last: parts => parts.at(-1),
  flags: () => ({ctrl: false, meta: false, shift: false}), setFlag: (flags, name) => {flags[name] = true;},
  modifiers(parts, flags) {for (const modifier of parts.slice(0, -1)) invoke("modifier", [flags, modifier]);},
  character: (ch, flags) => ({ch, ctrl: flags.ctrl, meta: flags.meta, shift: flags.shift}),
  sequence: (sequence, flags) => ({sequence, ctrl: flags.ctrl, meta: flags.meta, shift: flags.shift}),
  namedBinding: (name, flags) => ({name, ctrl: flags.ctrl, meta: flags.meta, shift: flags.shift}),
  named: value => namedKeys.has(value.toLowerCase()),
  printable(value) {if (Array.from(value).length <= 1) return false;for (const ch of value) if (!invoke("printableChar", [ch])) return false;return true;},
  point: ch => ch.codePointAt(0), keys: (overrides, defaults, command) => overrides?.[command] ?? defaults[command],
  parseKeys: keys => keys.map(parseBinding).filter(binding => binding !== undefined),
  rememberSequences(state, bindings) {for (const binding of bindings) invoke("remember", [state, binding]);},
  addSequence: (state, binding) => state.sequences.add(binding.sequence), setBindings: (state, command, bindings) => state.bindings.set(command, bindings),
  scan(state, event, mode) {for (const command of state.commands) {const commandBindings = state.bindings.get(command);if (commandBindings?.some(binding => invoke(mode, [state, binding, event]))) return {found: true, value: command};}return {found: false};},
  pending: (state, value) => {state.pendingSequence = value;}, concat: (pending, token) => `${pending}${token}`,
  hasPrefix(state) {const sequences = state.sequences, prefix = state.pendingSequence;for (const sequence of sequences) if (sequence.startsWith(prefix)) return true;return false;},
  canonicalModifiers: parsed => [parsed.ctrl ? "ctrl" : undefined, parsed.meta ? "meta" : undefined, parsed.shift ? "shift" : undefined].filter(modifier => modifier !== undefined),
  sequenceLower: parsed => parsed.sequence.toLowerCase(), canonical: (modifiers, key) => [...modifiers, key.toLowerCase()].join("+"),
  invalidOperation() {throw new TypeError("Invalid keymap operation");}
});
export function createKeymap(overrides, options) {
  const resolvedCommands = options?.commands ?? commands;
  const resolvedDefaults = options?.defaultBindings ?? defaultBindings;
  const state = {commands: resolvedCommands, bindings: new Map(), sequences: new Set(), pendingSequence: ""};
  for (const command of resolvedCommands) invoke("register", [state, command, overrides, resolvedDefaults]);
  return event => invoke("resolve", [state, event]);
}
export function canonicalizeBinding(binding) {return invoke("canonical", [binding]);}
