import * as native from "toolcraft-rust/frontmatter";
import * as reference from "toolcraft/frontmatter";
const own: typeof reference = native;
const original: typeof native = reference;
const options: native.ParseFrontmatterOptions = {uniqueKeys: true};
const parsed: native.ParsedFrontmatter = native.parseFrontmatter("body", options);
const originalParsed: reference.ParsedFrontmatter = parsed;
const document: native.ParsedFrontmatterDocument = native.parseFrontmatterDocument("body");
const originalDocument: reference.ParsedFrontmatterDocument = document;
const ownDocument: native.ParsedFrontmatterDocument = originalDocument;
const split: native.SplitFrontmatterResult = native.splitFrontmatterBlock("body");
const count: number = document.lineCounter.addNewLine(5);
const position: {line: number; col: number} = document.lineCounter.linePos(3);
declare const block: native.FrontmatterBlock;
const originalBlock: reference.FrontmatterBlock = block;
const error: native.FrontmatterParseError = new native.FrontmatterKindError("kind", {expected: "a", found: "b"});
const rendered: string = native.stringifyFrontmatter(parsed.frontmatter, parsed.body);
// @ts-expect-error options require a boolean uniqueKeys flag
native.parseFrontmatter("body", {uniqueKeys: "true"});
// @ts-expect-error the dependency's implementation-only counter type is not a Toolcraft export
type Extra = native.SourceLineCounter;
void [own, original, originalParsed, ownDocument, split, count, position, originalBlock, error, rendered];
export type {Extra};
