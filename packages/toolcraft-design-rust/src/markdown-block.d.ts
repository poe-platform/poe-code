import type {MdNode,MdRange} from "./md-ast.js";
export declare function parseBlocks(input:string):MdNode[];
export declare function parseBlockDocument(input:string):{frontmatter?:Record<string,unknown>;frontmatterRange?:MdRange;children:MdNode[]};
