import { createRequire } from "node:module";
import { color } from "./color.js";
import { getTheme } from "./theme.js";
import { resolveOutputFormat } from "./logging.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
export const typography = {
  bold: color.bold,
  dim: color.dim,
  italic: color.italic,
  underline: color.underline,
  strikethrough: color.strikethrough
};
const methods = [
  "intro",
  "heading",
  "section",
  "sectionHeader",
  "command",
  "argument",
  "option",
  "example",
  "usageCommand",
  "link",
  "muted",
  "error",
  "badge"
];
export const text = Object.fromEntries(
  methods.map((kind) => [
    kind,
    (content) => {
      const format = resolveOutputFormat();
      if (format === "json") return content;
      if (format === "markdown") return native.designTextMarkdown(kind, content);
      switch (kind) {
        case "intro":
          return getTheme().intro(content);
        case "heading":
          return getTheme().header(content);
        case "section":
          return typography.bold(content);
        case "sectionHeader":
          return typography.bold(content.toUpperCase());
        case "command":
        case "link":
          return getTheme().accent(content);
        case "argument":
        case "example":
        case "muted":
          return getTheme().muted(content);
        case "option":
          return color.yellow(content);
        case "usageCommand":
          return color.green(content);
        case "error":
          return getTheme().error(content);
        case "badge":
          return getTheme().badge(content);
      }
    }
  ])
);
text.selectLabel = (label, detail) => {
  if (!detail) return label;
  if (resolveOutputFormat() !== "terminal") return `${label} — ${detail}`;
  return `${label} ${typography.dim("—")} ${typography.dim(detail)}`;
};
