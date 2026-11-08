import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {Prompt} from "./prompt-core.js";
import {color} from "./color.js";
import {GLYPHS, symbol} from "./prompt-glyphs.js";
import {limitOptions} from "./prompt-pagination.js";
import {wrapTextWithPrefix} from "./prompt-wrap.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke = createComponentPolicy(native.designPromptSelectionPolicy, {
  truthy: value => !!value, same: (a, b) => a === b, lt: (a, b) => a < b, add: (a, b) => a + b, undefined: () => undefined,
  allDisabled: options => !!options.every(option => option.disabled),
  normalize: (index, options) => (index + options.length) % options.length,
  disabledAt: (options, index) => !!options[index]?.disabled,
  initialIndex: opts => Math.max(opts.options.findIndex(option => option.value === opts.initialValue), 0),
  error(message) {throw new Error(message);},
  moveUp: p => {p._cursor = findNonDisabled(p._cursor - 1, -1, p.options);},
  moveDown: p => {p._cursor = findNonDisabled(p._cursor + 1, 1, p.options);},
  selectValue: p => p.setValue(p.options[p._cursor]?.value),
  noPrompt: () => process.env.POE_NO_PROMPT, resolveSelect: p => Promise.resolve(p.value), nonTty: (p, fallback) => fallback(),
  hint: option => color.dim(` (${option.hint})`), dimLabel: option => color.dim(option.label),
  strikeLabel: option => color.dim.strikethrough(option.label), disabledLabel: option => color.gray.strikethrough(option.label),
  colorGlyph: (name, key) => color[name](GLYPHS[key]), append: (left, right) => `${left}${right}`, symbol,
  selectedOption: p => p.visibleOptions[p.cursor], output: opts => opts.output ?? process.stdout, wrap: wrapTextWithPrefix,
  selectLines: (p, opts) => limitOptions({cursor: p.cursor, options: p.visibleOptions, output: opts.output ?? process.stdout, maxItems: opts.maxItems, columnPadding: 3, style: (option, active) => invoke("selectOption", [option, active])}).flatMap(line => line.split("\n").map(physicalLine => `${color.cyan(GLYPHS.bar)}  ${physicalLine}`)),
  joinLines: lines => lines.join("\n"), invalidOperation() {throw new TypeError("Invalid selection operation");}
});
class SelectPrompt extends Prompt {
  options;
  constructor(opts) {
    const cursor = invoke("selectInitial", [opts]);
    super({...opts, initialValue: opts.options[cursor]?.value, render: prompt => invoke("selectFrame", [prompt, opts])}, false);
    this.options = opts.options;
    this._cursor = cursor;
    this.setValue(this.options[this._cursor]?.value);
    this.on("cursor", action => {invoke("selectCursor", [this, action]);});
  }
  get visibleOptions() {return this.options;}
  promptNonTty() {return invoke("selectNonTty", [this, () => super.promptNonTty()]);}
}
export function findNonDisabled(start, direction, options) {return invoke("find", [start, direction, options]);}
export function selectPrompt(opts) {return new SelectPrompt(opts).prompt();}
