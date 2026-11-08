import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {Prompt} from "./prompt-core.js";
import {findNonDisabled} from "./prompt-select.js";
import {color} from "./color.js";
import {GLYPHS, symbol} from "./prompt-glyphs.js";
import {limitOptions} from "./prompt-pagination.js";
import {wrapTextWithPrefix} from "./prompt-wrap.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke = createComponentPolicy(native.designPromptMultiselectPolicy, {
  truthy: value => !!value, nullish: value => value == null, undefined: () => undefined, array: () => [],
  same: (a, b) => a === b, lt: (a, b) => a < b, gt: (a, b) => a > b, add: (a, b) => a + b,
  allDisabled: options => !!options.every(option => option.disabled), normalize: (index, options) => (index + options.length) % options.length,
  disabledAt: (options, index) => !!options[index]?.disabled, error(message) {throw new Error(message);},
  moveUp: p => {p._cursor = findNonDisabled(p._cursor - 1, -1, p.options);}, moveDown: p => {p._cursor = findNonDisabled(p._cursor + 1, 1, p.options);},
  toggleFocused: p => p.toggleFocused(), toggleAll: p => p.toggleAll(), invert: p => p.invert(),
  focusedOption: p => p.options[p.cursor], toggleOption: (p, option) => p.toggleValue(option.value),
  setToggled: (p, current, value) => p.setValue(invoke("toggleResult", [current, value])),
  includes: (current, value) => !!current.includes(value), removeValue: (current, value) => current.filter(item => item !== value), addValue: (current, value) => [...current, value],
  enabledValues: p => p.enabledOptions().map(option => option.value), allSelected: (enabled, current) => !!enabled.every(value => current.includes(value)),
  setValue: (p, value) => p.setValue(value), setInverted: (p, current) => p.setValue(p.enabledOptions().map(option => option.value).filter(value => !current.includes(value))),
  noPrompt: () => process.env.POE_NO_PROMPT, resolveValues: p => Promise.resolve(p.value ?? []), nonTty: (p, fallback) => fallback(),
  hasValue: (values, value) => (values ?? []).includes(value), hint: option => color.dim(` (${option.hint})`),
  dimLabel: option => color.dim(option.label), strikeLabel: option => color.dim.strikethrough(option.label), disabledLabel: option => color.gray.strikethrough(option.label),
  colorGlyph: (name, key) => color[name](GLYPHS[key]), append: (left, right) => `${left}${right}`, symbol, colorError: p => color.yellow(p.error),
  selectedOptions: p => p.visibleOptions.filter(option => {const values = p.value, value = option.value;return (values ?? []).includes(value);}),
  countLabel: selected => color.dim(`${selected.length} selected`), countStrikeLabel: selected => color.dim.strikethrough(`${selected.length} selected`),
  selectedLabels: (p, selected) => selected.map(option => invoke("selectedLabel", [p, option])).join(", "),
  output: opts => opts.output ?? process.stdout, wrap: wrapTextWithPrefix,
  lines: (p, opts) => limitOptions({cursor: p.cursor, options: p.visibleOptions, output: opts.output ?? process.stdout, maxItems: opts.maxItems, columnPadding: 3, style: (option, active) => invoke("option", [option, p.value, active])}).flatMap(line => line.split("\n").map(physicalLine => invoke("line", [p, physicalLine]))),
  body: (header, lines) => [header, ...lines], pushError: (body, p) => body.push(invoke("errorEnd", [p])), pushEnd: body => body.push(color.cyan(GLYPHS.barEnd)),
  joinLines: lines => lines.join("\n"), invalidOperation() {throw new TypeError("Invalid multiselect operation");}
});
class MultiselectPrompt extends Prompt {
  options;
  constructor(opts) {
    const cursor = invoke("initial", [opts]);
    super({...opts, initialValue: [...(opts.initialValues ?? [])], validate: value => invoke("validate", [opts, value]), render: prompt => invoke("frame", [prompt, opts])}, false);
    this.options = opts.options;
    this._cursor = cursor;
    this.on("cursor", action => {invoke("cursor", [this, action]);});
    this.on("key", key => {invoke("key", [this, key]);});
  }
  get visibleOptions() {return this.options;}
  enabledOptions() {return this.options.filter(option => !option.disabled);}
  toggleFocused() {invoke("toggleFocused", [this]);}
  toggleValue(value) {invoke("toggleValue", [this, value]);}
  toggleAll() {invoke("toggleAll", [this]);}
  invert() {invoke("invert", [this]);}
  promptNonTty() {return invoke("nonTty", [this, () => super.promptNonTty()]);}
}
export function multiselectPrompt(opts) {return new MultiselectPrompt(opts).prompt();}
