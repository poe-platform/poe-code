import {createRequire} from "node:module";
import {getThemeConfig} from "./theme-state.js";
import {brands} from "./tokens-brand.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
export const promptTheme={
  symbols:native.designPromptThemeSymbols(),
  style:{get accentColor(){return brands[getThemeConfig().brand].primary;}}
};
