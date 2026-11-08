import { createRequire } from "node:module";
import { text } from "toolcraft-design-rust";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");

function muted(value) {
  return process.stderr.isTTY === true ? text.muted(value) : value;
}

export function renderSourceSnippet(opts) {
  return callNative(native.renderSourceSnippet, {
    lines: protect(() => opts.source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")),
    line: protect(() => {
      const value = opts.line;
      return Number.isFinite(value) ? value : NaN;
    }),
    context: protect(() => Math.floor(opts.context ?? 2)),
    header: protect((line) => {
      if (opts.filePath === undefined) return undefined;
      return muted(`--> ${opts.filePath}:${line}${opts.column === undefined ? "" : `:${Math.max(1, opts.column)}`}`);
    }),
    muted: protect(muted),
    caret: protect((width) => {
      if (opts.column === undefined) return undefined;
      const column = Math.max(1, Math.floor(opts.column));
      const gutter = muted(" ".repeat(width));
      const padding = " ".repeat(column - 1);
      const caret = process.stderr.isTTY === true ? text.error("^") : "^";
      return `${gutter} | ${padding}${caret}`;
    })
  });
}
