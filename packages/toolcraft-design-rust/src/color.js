import {supportsColor} from "./color-support.js";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const styles = Object.fromEntries(
  native.designColorNames().map((name) => [name, native.designColorStyle(name)])
);
export function createColor(open = "") {
  const builder = (text) => {
    const value = String(text);
    return supportsColor() && open.length > 0 ? native.designColorApply(value, open) : value;
  };
  for (const name of Object.keys(styles))
    Object.defineProperty(builder, name, {
      configurable: true,
      enumerable: true,
      get: () => createColor(open + styles[name])
    });
  const hex = (value, background) => {
    let style;
    try {
      style = native.designHexStyle(value, background);
    } catch {
      throw Error(`Invalid hexadecimal color: ${value}`);
    }
    return createColor(open + style);
  };
  builder.hex = (value) => hex(value, false);
  builder.bgHex = (value) => hex(value, true);
  builder.rgb = (r, g, b) => createColor(open + native.designRgbStyle(r, g, b, false));
  builder.bgRgb = (r, g, b) => createColor(open + native.designRgbStyle(r, g, b, true));
  return builder;
}
export const color = createColor();
