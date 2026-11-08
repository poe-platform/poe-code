import { createRequire } from "node:module";
import { color } from "./color.js";
import { getTheme } from "./theme.js";
import { resolveOutputFormat } from "./logging.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");

function readSymbol(name) {
  const [operation, value] = native.designSymbol(name, resolveOutputFormat());
  if (operation === "magenta") return color.magenta(value);
  if (operation === "theme") return getTheme()[value];
  return value;
}

export const symbols = {
  get info() { return readSymbol("info"); },
  get success() { return readSymbol("success"); },
  get resolved() { return readSymbol("resolved"); },
  get errorResolved() { return readSymbol("errorResolved"); },
  get bar() { return readSymbol("bar"); },
  cornerTopRight: native.designSymbol("cornerTopRight", "terminal")[1],
  cornerBottomRight: native.designSymbol("cornerBottomRight", "terminal")[1],
  get warning() { return readSymbol("warning"); },
  get active() { return readSymbol("active"); },
  get inactive() { return readSymbol("inactive"); }
};
