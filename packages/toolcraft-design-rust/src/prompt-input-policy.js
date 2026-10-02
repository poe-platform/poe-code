import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {color} from "./color.js";
import {graphemes} from "./graphemes.js";
import {GLYPHS, symbol, symbolBar} from "./prompt-glyphs.js";
import {wrapTextWithPrefix} from "./prompt-wrap.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
export const invoke = createComponentPolicy(native.designPromptComponentsPolicy, {
  undefined: () => undefined, truthy: value => !!value, nullish: value => value == null,
  finalizeText: (p, opts) => p.setValue(invoke("defaultText", [p.value, opts])),
  textBefore: p => p.userInput.slice(0, p.cursor), textCurrent: p => graphemes(p.userInput.slice(p.cursor))[0],
  textAfter: (p, current) => p.userInput.slice(p.cursor + (current?.length ?? 0)),
  maskCursor: p => graphemes(p.userInput.slice(0, p.cursor)).length * p.mask.length,
  maskBefore: (masked, cursor) => masked.slice(0, cursor),
  maskCurrent: (masked, cursor, p) => masked.slice(cursor, cursor + p.mask.length),
  maskAfter: (masked, cursor, p) => masked.slice(cursor + p.mask.length),
  placeholder(opts) {const [first, ...rest] = graphemes(opts.placeholder ?? ""); return [first, rest];},
  hasInput: p => p.userInput.length > 0, dimRest: parts => color.dim(parts[1].join("")),
  colorGlyph: (name, key) => color[name](GLYPHS[key]), color: (name, value) => color[name](value),
  colorError: p => color.yellow(p.error), dim: value => color.dim(value), strike: value => color.dim.strikethrough(value),
  symbol, symbolBar, append: (left, right) => `${left}${right}`,
  output: opts => opts.output ?? process.stdout, wrap: wrapTextWithPrefix,
  invalidOperation() {throw new TypeError("Invalid input prompt operation");}
});
