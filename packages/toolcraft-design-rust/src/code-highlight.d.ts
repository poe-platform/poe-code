import type {MdNode,CodeToken} from "./md-ast.js";
export declare function highlightCodeBlock(node:Pick<Extract<MdNode,{type:"code"}>,"value"|"lang"|"tokens">):CodeToken[]|undefined;
