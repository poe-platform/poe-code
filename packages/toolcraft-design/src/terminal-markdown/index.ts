import { parse } from "./parser.js";
import { render, type RenderOptions } from "./renderer.js";

export type { MdNode } from "./ast.js";
export { parse } from "./parser.js";
export { render } from "./renderer.js";
export type { RenderOptions } from "./renderer.js";

export function renderMarkdown(markdown: string, options?: RenderOptions): string {
  const { ast } = parse(markdown);
  return render(ast, options);
}
