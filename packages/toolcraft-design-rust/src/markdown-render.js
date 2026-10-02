import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {symbols} from "./symbols.js";
import {displayWidth} from "./terminal.js";
import {getTheme} from "./theme.js";
import {stripAnsi} from "./ansi.js";
import {spacing} from "./spacing.js";
import {widths} from "./widths.js";
import {typography} from "./text.js";
import {highlightCodeBlock} from "./code-highlight.js";
import {renderInline,tokenizeInline} from "./markdown-inline.js";
import {stripHtmlTags,tokenizeText,trimTrailingSpaces,wrapTokens,wrapText} from "./markdown-text.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const visibleWidth=value=>displayWidth(stripAnsi(value));
const invoke=createComponentPolicy(native.designMarkdownRenderPolicy,{
  truthy:value=>!!value,isFalse:value=>value===false,isNull:value=>value===null,type:value=>typeof value,
  same:(a,b)=>a===b,le:(a,b)=>a<=b,lt:(a,b)=>a<b,gt:(a,b)=>a>b,add:(a,b)=>a+b,subtract:(a,b)=>a-b,
  finite:value=>!!Number.isFinite(value),width:value=>Math.max(1,value),
  invalidWidth(){throw new Error("width must be a positive finite number.");},
  undefined:()=>undefined,array:()=>[],at:(value,index)=>value[index],hasChildren:node=>"children" in node,
  join:(value,separator)=>value.join(separator),trimEnd:value=>value.trimEnd(),trim:value=>value.trim(),string:value=>String(value),
  paragraph:lines=>`${lines.join("\n")}\n\n`,paragraphText:value=>`${value}\n\n`,concat:(a,b)=>`${a}${b}`,
  children:(nodes,ctx)=>nodes.map(node=>invoke("node",[node,ctx])).join(""),
  rootChildren:(node,ctx)=>invoke("children",[node.children.filter(child=>invoke("notDefinition",[child])),ctx]),
  inlineChildren:(node,ctx)=>renderInline(node.children,ctx),inlineNode:(node,ctx)=>renderInline([node],ctx).join("\n"),
  headingLines:(lines,node,ctx)=>lines.map(line=>invoke("styleHeading",[line,node.depth,ctx])),
  underlineWidth:lines=>Math.max(...lines.map(line=>visibleWidth(line))),
  heading:(lines,width,ctx)=>`${lines.join("\n")}\n${ctx.theme.header("─".repeat(width))}\n\n`,
  header:(value,ctx)=>ctx.theme.header(typography.bold(value)),bold:value=>typography.bold(value),mutedBold:(value,ctx)=>ctx.theme.muted(typography.bold(value)),
  divider:ctx=>`${ctx.theme.divider("─".repeat(ctx.width))}\n\n`,
  prefix:()=>`${symbols.bar} `,emptyQuote:()=>`${symbols.bar}\n\n`,bar:()=>symbols.bar,
  body(node,prefix,ctx){const nodes=node.children,narrowed={...ctx,width:Math.max(1,ctx.width-visibleWidth(prefix))};return invoke("blockChildren",[nodes,narrowed]);},
  quoteLines:(body,prefix,style)=>body.split("\n").map(line=>invoke("quoteLine",[line,prefix,style])),
  dimLine:(prefix,line)=>`${prefix}${typography.dim(line)}`,prefixed:(prefix,line)=>`${prefix}${line}`,
  labelLine:(prefix,node,ctx)=>`${prefix}${invoke("alertLabel",[node.kind,ctx])}`,
  alert:(label,lines)=>`${label}\n${lines.join("\n")}\n\n`,alertLabel:(ctx,style,label)=>ctx.theme[style](label),
  indent:()=>" ".repeat(spacing.sm),codeLines:node=>node.value.split("\n").map(line=>stripAnsi(line)),
  longestLine:lines=>lines.reduce((max,line)=>Math.max(max,visibleWidth(line)),0),
  codeBorderWidth:(ctx,indent,longest)=>Math.max(3,Math.min(ctx.width-indent.length,longest)),
  codeBorder:(ctx,indent,width)=>ctx.theme.muted(`${indent}${"─".repeat(width)}`),
  highlight:(node,source,ctx)=>invoke("codeTokens",[highlightCodeBlock({lang:node.lang,value:source}),ctx])?.split("\n"),
  styledTokens:(tokens,ctx)=>tokens.map(token=>invoke("codeToken",[token,ctx])).join(""),
  tokenFormatter:(ctx,style)=>ctx.theme[style],accentFormatter:ctx=>value=>ctx.theme.accent(typography.bold(value)),identityFormatter:()=>value=>value,
  applyToken:(formatter,token)=>formatter(token.value),
  codeContent:(lines,indent)=>lines.map(line=>`${indent}${line}`).join("\n"),codeBlock:(border,content)=>`${border}\n${content}\n${border}\n\n`,
  listItems:(node,ctx)=>node.children.map((child,index)=>invoke("listChild",[child,node,index,ctx])).filter(item=>item.length>0),
  active:()=>symbols.active,inactive:()=>symbols.inactive,orderedMarker:(list,index)=>`${(list.start??1)+index}.`,
  firstPrefix:(indent,marker)=>`${indent}${marker} `,continuationPrefix:(indent,marker)=>`${indent}${" ".repeat(marker.length+1)}`,
  prefixBlock:(body,first,rest)=>body.split("\n").map((line,index)=>invoke("prefixLine",[line,index,first,rest])).join("\n"),
  blockParts:(nodes,ctx)=>nodes.map(child=>({type:child.type,value:invoke("node",[child,ctx]).trimEnd()})).filter(child=>child.value.length>0),
  appendBlock:(output,separator,current)=>output+`${separator}${current.value}`,
  entries:data=>Object.entries(data),frontmatterLines:(entries,ctx)=>entries.flatMap(([key,value])=>wrapText(`${key}: ${invoke("frontmatterValue",[value])}`,ctx.width).map(line=>typography.dim(line))),
  json(value){const ancestors=[];return JSON.stringify(value,function(_key,nestedValue){return invoke("jsonValue",[nestedValue,this,ancestors]);});},
  last:values=>values[values.length-1],pop:values=>values.pop(),includes:(values,value)=>!!values.includes(value),append:(values,value)=>values.push(value),
  htmlValue:node=>stripAnsi(stripHtmlTags(node.value)).trim(),wrapText,
  footnoteState:nodes=>({definitions:new Map(nodes.flatMap(child=>invoke("definitionPair",[child]))),labelsInOrder:[],numbers:new Map()}),
  definitionPair:child=>[[child.label,child]],labelLength:footnotes=>footnotes.labelsInOrder.length,
  labelAt:(footnotes,index)=>footnotes.labelsInOrder[index],definitionAt:(footnotes,label)=>footnotes.definitions.get(label),numberAt:(footnotes,label)=>footnotes.numbers.get(label),
  appendFootnote:(rendered,node,number,ctx)=>rendered.push(invoke("footnoteDefinition",[node,number,ctx])),
  footnoteMarker:number=>typography.dim(`[${number}]`),footnotePrefix:marker=>`${" ".repeat(spacing.sm)}${marker} `,
  footnoteRest:number=>`${" ".repeat(spacing.sm+visibleWidth(`[${number}] `))}`,
  tableRows:node=>node.children.filter(child=>invoke("isTableRow",[child])),
  columnCount:(node,rows)=>Math.max(node.align.length,...rows.map(row=>row.children.length)),
  renderedRows:(rows,count,ctx)=>rows.map(row=>Array.from({length:count},(_,index)=>invoke("renderedCell",[row.children[index],ctx]))),
  columnWidths:(rows,count)=>Array.from({length:count},(_,index)=>Math.max(...rows.map(row=>visibleWidth(row[index]??"")),0)),
  tableWidth:widths=>widths.reduce((total,width)=>total+width+spacing.sm*2,widths.length+1),
  alignedRows:(rows,widths,node,ctx)=>rows.map((row,rowIndex)=>row.map((cell,index)=>invoke("alignedCell",[cell,rowIndex,widths,index,node,ctx]))),
  outputRows:(lines,widths,ctx)=>lines.map((row,index)=>invoke("outputRow",[row,index,lines,widths,ctx])),
  tableLine:row=>`${symbols.bar}${row.map(cell=>`${" ".repeat(spacing.sm)}${cell}${" ".repeat(spacing.sm)}`).join(symbols.bar)}${symbols.bar}`,
  tableDivider:(line,widths,ctx)=>`${line}\n${ctx.theme.muted(`├${widths.map(width=>"─".repeat(width+spacing.sm*2)).join("┼")}┤`)}`,
  optionalType:value=>value?.type,
  tableCell:(node,ctx)=>wrapTokens(tokenizeInline(node.children,ctx),Number.MAX_SAFE_INTEGER).join(" "),
  extraSpace:(value,width)=>Math.max(0,width-visibleWidth(value)),right:(value,space)=>`${" ".repeat(space)}${value}`,
  center:(value,space)=>{const left=Math.floor(space/2),right=space-left;return `${" ".repeat(left)}${value}${" ".repeat(right)}`;},left:(value,space)=>`${value}${" ".repeat(space)}`,
  dataRows:rows=>rows.slice(1),
  headerLines:(header,count,ctx)=>Array.from({length:count},(_,index)=>tokenizeText(invoke("stackedLabel",[header.children[index],index,ctx]),[typography.bold])).flatMap(tokens=>wrapTokens(tokens,ctx.width)),
  stackedBlocks:(rows,header,count,ctx)=>rows.map(row=>Array.from({length:count},(_,index)=>invoke("stackedField",[header.children[index],row.children[index],index,ctx])).filter(field=>field.length>0).join("\n")).filter(block=>block.length>0),
  stackedOutput:blocks=>`${blocks.join("\n\n")}\n\n`,columnLabel:index=>`Column ${index+1}`,
  labelText:(cell,ctx)=>stripAnsi(invoke("tableCell",[cell,ctx])).trim(),
  valueTokens:(cell,ctx)=>trimTrailingSpaces(tokenizeInline(cell.children,ctx)),emptyTokens:ctx=>[{type:"word",value:"—",formatters:[ctx.theme.muted]}],
  fieldTokens:(header,cell,index,ctx)=>[...tokenizeText(invoke("stackedLabel",[header,index,ctx]),[typography.bold]),{type:"word",value:":",formatters:[typography.bold]},{type:"space",value:" "},...invoke("stackedValue",[cell,ctx])],
  fieldOutput:(tokens,ctx)=>wrapTokens(tokens,ctx.width).join("\n"),
  invalidOperation(){throw new TypeError("Invalid terminal Markdown operation");}
});

export function render(ast,options={}) {
  const requestedWidth=options.width??process.stdout.columns??widths.maxLine;
  const width=invoke("width",[requestedWidth]);
  const context={width,showFrontmatter:options.showFrontmatter??false,syntaxHighlight:options.syntaxHighlight??false,theme:getTheme(),footnotes:invoke("footnoteState",[ast])};
  return invoke("node",[ast,context]);
}
