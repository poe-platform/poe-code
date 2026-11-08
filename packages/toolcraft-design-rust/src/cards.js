import { createRequire } from "node:module";
import { createComponentPolicy } from "./component-host.js";
import stringWidth from "./string-width.js";
import { wrapAnsi } from "./wrap-ansi.js";
import { widths } from "./widths.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const wrap=(value,width)=>wrapAnsi(value,Math.max(1,width),{hard:true,trim:true}).split("\n");
const invoke=createComponentPolicy(native.designCardsPolicy,{
  undefined:()=>undefined,array:()=>[],truthy:value=>!!value,le:(a,b)=>a<=b,
  emptyArray:rows=>rows.length===0,nonemptyArray:rows=>rows.length>0,
  width:options=>options.width??widths.maxLine,
  header:options=>options.theme.header(options.title),subtitle:options=>options.theme.muted(options.subtitle),
  identity:(header,subtitle)=>[header,subtitle].filter(value=>value!==undefined).join("  "),
  hasBadges:options=>!!options.badges?.length,
  hero:(options,identity)=>`${identity}\n${options.theme.muted(options.badges.map(badge=>badge[0]+badge.slice(1).toLowerCase()).join(" · "))}`,
  start:hero=>[hero],blocks:blocks=>blocks.join("\n\n"),
  proseBlocks(options,width,blocks){for(const prose of options.prose??[]) blocks.push(invoke("prose",[options,prose,width]));},
  sectionBlocks(options,width,blocks){for(const section of options.sections??[]) invoke("section",[options,section,width,blocks]);},
  titledProse:(options,prose,width)=>[options.theme.header(prose.title),wrap(prose.value,width).join("\n")].join("\n"),
  plainProse:(_options,prose,width)=>wrap(prose.value,width).join("\n"),
  pushSection:(options,section,rows,blocks)=>blocks.push(invoke("sectionContent",[options,section,rows])),
  titledSection:(options,section,rows)=>[options.theme.header(section.title),...rows].join("\n"),
  plainSection:(_options,_section,rows)=>rows.join("\n"),
  labelWidth:rows=>Math.max(...rows.map(row=>stringWidth(row.label))),
  valueWidth:(width,label)=>Math.max(20,width-label-2),continuation:label=>" ".repeat(label+2),
  renderRows:(rows,theme,label,value,continuation)=>rows.flatMap(row=>invoke("row",[row,theme,label,value,continuation])),
  wrap,
  rowLines:(row,theme,label,values,continuation)=>[
    `${theme.muted(row.label.padEnd(label))}  ${values[0]??""}`,
    ...values.slice(1).map(value=>`${continuation}${value}`)
  ],
  previewLimit:options=>options.maxPreviewLines??8,
  inspectorSections:options=>(options.sections??[]).filter(section=>invoke("hasFields",[section])).map(section=>({
    title:section.title,rows:section.fields.map(field=>({label:field.label,value:field.value}))
  })),
  detailOptions:(options,preview,sections)=>({
    theme:options.theme,title:options.title,subtitle:options.subtitle,badges:options.badges,
    prose:invoke("previewProse",[options,preview]),sections,width:options.width
  }),
  proseOption:(options,preview)=>[{title:options.previewTitle??"Preview",value:preview}],
  previewLines:value=>value.split("\n").map(line=>invoke("previewLine",[line])).map(line=>line.trimEnd()),
  endsCR:line=>line.endsWith("\r"),withoutCR:line=>line.slice(0,-1),
  firstContent:lines=>lines.findIndex(line=>line.trim().length>0),missingContent:first=>first===-1,
  sliceContent:(lines,first)=>lines.slice(first),joinLines:lines=>lines.join("\n"),
  truncatedPreview:(lines,limit)=>[...lines.slice(0,limit),`... ${lines.length-limit} more line(s)`].join("\n"),
  invalidOperation(){throw new TypeError("Invalid card operation");}
});
export function renderDetailCard(options){return invoke("detail",[options]);}
export function renderInspectorCard(options){return invoke("inspector",[options]);}
