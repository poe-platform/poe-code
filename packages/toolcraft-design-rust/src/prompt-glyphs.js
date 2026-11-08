import {createRequire} from "node:module";
import {color} from "./color.js";
import {createComponentPolicy} from "./component-host.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke = createComponentPolicy(native.designPromptComponentsPolicy, {
  windows: () => process.platform.startsWith("win"), env: key => process.env[key],
  truthy: value => !!value, true: () => true, false: () => false,
  colorGlyph: (name, key) => color[name](GLYPHS[key])
});
export const UNICODE = invoke("unicode", []);
const values = native.designPromptGlyphs(UNICODE);
export const GLYPHS = {
  stepActive: values[0], stepCancel: values[1], stepError: values[2], stepSubmit: values[3],
  barStart: values[4], bar: values[5], barEnd: values[6], radioActive: values[7], radioInactive: values[8],
  checkboxActive: values[9], checkboxSelected: values[10], checkboxInactive: values[11], passwordMask: values[12], ellipsis: values[13]
};
export function symbol(state) {return invoke("symbol", [state]);}
export function symbolBar(state) {return invoke("symbolBar", [state]);}
