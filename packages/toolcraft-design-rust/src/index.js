import { createRequire } from "node:module";
import { createTemplateEngine } from "./engine.js";
export { TemplateParseError } from "./engine.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
export const { renderTemplate, getTemplatePartialNames, resolveTemplatePartials } =
  createTemplateEngine(native);

export function computeDashboardLayout(options) {
  const data = native.dashboardLayout(
    Math.floor(options.totalWidth),
    Math.floor(options.totalHeight),
    Math.floor(options.borderWidth ?? 1),
    Math.floor(options.footerHeight ?? 1),
    Math.floor(options.rightPaneWidth ?? 25)
  );
  const layout = {
    outerBorder: { x: 0, y: 0, width: data[1], height: data[2] },
    leftPane: { x: data[3], y: data[4], width: data[5], height: data[6] },
    rightPane: { x: data[7], y: data[8], width: data[9], height: data[10] },
    divider: { x: data[11], top: data[12], bottom: data[13] },
    footer: { x: data[14], y: data[15], width: data[16], height: data[17] },
    footerDivider: { y: data[18], left: data[19], right: data[20] }
  };
  if (data[0] !== 0)
    layout.summary = { x: data[21], y: data[22], width: data[23], height: data[24] };
  return layout;
}
