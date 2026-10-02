import type {MdNode} from "./md-ast.js";
export interface HtmlRenderOptions {
  showFrontmatter?: boolean;
  allowRawHtml?: boolean;
  syntaxHighlight?: boolean;
}
export declare function renderHtml(ast: MdNode, options?: HtmlRenderOptions): string;
