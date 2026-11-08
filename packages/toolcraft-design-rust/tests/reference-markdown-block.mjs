import {readFileSync} from "node:fs";
import ts from "typescript";

const url=new URL("../../toolcraft-design/dist/terminal-markdown/parser/block.js",import.meta.url);
let source=readFileSync(url,"utf8");
const syntax=ts.createSourceFile(url.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
for(const declaration of syntax.statements.filter(ts.isImportDeclaration).reverse()){
  const specifier=declaration.moduleSpecifier;
  source=source.slice(0,specifier.getStart(syntax))+JSON.stringify(new URL(specifier.text,url).href)+source.slice(specifier.end);
}
const names=["parseBlocksWithOptions","applyInlineParsing","createOffsetMap","parseOpeningFence","parseAtxHeadingLine","isClosingFence","isThematicBreakLine","parseSetextUnderline","parsePipeTableCellSegments","parsePipeTableSeparator","parseBlockquoteLine","parseAlertMarker","parseFootnoteDefinitionMarker","parseBlockHtmlTagStart","containsClosingHtmlTag","parseListMarker","parseTaskMarker","readLine","readLeadingWhitespace","skipLeadingBlockIndent","BLOCK_HTML_TAGS"];
export const referenceBlock=await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport {${names.join(",")}};`).toString("base64")}`);
