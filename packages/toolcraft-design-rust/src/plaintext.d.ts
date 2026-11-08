import type { MdNode } from "./md-ast.js";
export interface PlaintextRenderOptions {
    announceHeadings?: boolean;
    announceCode?: boolean;
    announceAlerts?: boolean;
    showLinks?: boolean;
    expandLinks?: boolean;
    includeFrontmatter?: boolean;
}
export declare function renderPlaintext(ast: MdNode, options?: PlaintextRenderOptions): string;
export declare function renderMarkdownPlaintext(markdown:string,options?:PlaintextRenderOptions):string;
