import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {Prompt} from "./prompt-core.js";
import {color} from "./color.js";
import {GLYPHS, symbol, symbolBar} from "./prompt-glyphs.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke = createComponentPolicy(native.designPromptComponentsPolicy, {
  undefined: () => undefined, truthy: value => !!value, env: key => process.env[key],
  setValue: (p, value) => p.setValue(value), submitState: p => {p.state = "submit";},
  finalize: p => p.emit("finalize"), render: p => p.render(), close: p => p.close(),
  toggle: p => p.setValue(!p.value), resolveConfirm: p => Promise.resolve(p.value ?? true),
  nonTty: (p, fallback) => fallback(),
  colorGlyph: (name, key) => color[name](GLYPHS[key]), color: (name, value) => color[name](value),
  symbol, symbolBar, append: (left, right) => `${left}${right}`,
  submittedLabel: p => color.dim(p.value ? "Yes" : "No"),
  cancelledLabel: p => color.dim.strikethrough(p.value ? "Yes" : "No")
});
class ConfirmPrompt extends Prompt {
  constructor(opts) {
    super({...opts, initialValue: opts.initialValue ?? true, render: prompt => invoke("confirmFrame", [prompt, opts])}, false);
    this.on("confirm", value => {invoke("confirm", [this, value]);});
    this.on("cursor", action => {invoke("confirmCursor", [this, action]);});
  }
  promptNonTty() {return invoke("confirmNonTty", [this, () => super.promptNonTty()]);}
}
export function confirmPrompt(opts) {return new ConfirmPrompt(opts).prompt();}
