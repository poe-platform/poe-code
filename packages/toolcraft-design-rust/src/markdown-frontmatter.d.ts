import type {MdRange} from "./md-ast.js";
type ExtractedFrontmatter={frontmatter?:Record<string,unknown>;body:string;range?:MdRange};
export declare function extractFrontmatter(markdown:string):ExtractedFrontmatter;
export {};
