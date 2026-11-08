import type {MdNode} from "./md-ast.js";
export interface RenderOptions {
  width?: number;
  showFrontmatter?: boolean;
  syntaxHighlight?: boolean;
}
export declare function render(ast: MdNode, options?: RenderOptions): string;
