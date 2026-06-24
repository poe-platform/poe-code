import { parse } from "./parser.js";
import { renderHtml, type HtmlRenderOptions } from "./html-renderer.js";
import { render, type RenderOptions } from "./renderer.js";

export type { CodeToken, CodeTokenKind, MdNode } from "./ast.js";
export { renderHtml } from "./html-renderer.js";
export type { HtmlRenderOptions } from "./html-renderer.js";
export { parse } from "./parser.js";
export { render } from "./renderer.js";
export type { RenderOptions } from "./renderer.js";

export function renderMarkdown(markdown: string, options?: RenderOptions): string {
  const { ast } = parse(markdown);
  return render(ast, options);
}

export function renderMarkdownHtml(markdown: string, options?: HtmlRenderOptions): string {
  const { ast } = parse(markdown);
  return renderHtml(ast, options);
}
