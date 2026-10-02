import type {MdNode} from "./md-ast.js";
export type ParseInlineOptions={footnoteLabels?:ReadonlySet<string>;allowLiteralAutolinks?:boolean;offset?:number;offsets?:readonly number[]};
export declare function parseInline(raw:string,options?:ParseInlineOptions):MdNode[];
