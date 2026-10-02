import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {resolveOutputFormat,stripAnsi} from "./logging.js";
import {color} from "./color.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke=createComponentPolicy(native.designNotePolicy,{
  format:resolveOutputFormat,strip:stripAnsi,title:title=>title??"",truthy:value=>!!value,
  inline:value=>value.replaceAll("\r\n"," ").replaceAll("\n"," ").replaceAll("\r"," "),
  split:value=>value.split("\n"),heading:title=>`> **${title}**\n`,quote:lines=>lines.map(line=>`> ${line}`).join("\n"),
  markdown:(heading,body)=>`${heading}${body}\n`,json:(title,message)=>`${JSON.stringify({type:"note",title,message})}\n`,
  newline:value=>`${value}\n`,write:(write,chunk)=>write(chunk),undefined:()=>undefined,
  content:message=>["",...message.split("\n"),""],widths:lines=>lines.map(line=>stripAnsi(line).length),
  width:(title,widths)=>Math.max(title,...widths)+2,lineWidth:(width,title)=>Math.max(width-title-1,1),
  green:value=>color.green(value),gray:value=>color.gray(value),reset:value=>color.reset(value),
  rule:width=>"─".repeat(width),spaces:width=>" ".repeat(width),pair:(a,b)=>`${a}${b}`,
  terminalHeading:(diamond,title,rule)=>`${diamond}  ${title} ${rule}`,rows:(lines,width)=>lines.map(line=>invoke("row",[line,width])),
  bottom:rule=>`├${rule}╯`,terminal:(guide,heading,lines,bottom)=>[guide,heading,...lines,bottom].join("\n"),
  rowPrefix:(first,line,padding)=>`${first}  ${line}${padding}`,add:(a,b)=>a+b,subtract:(a,b)=>a-b,
  invalidOperation(){throw new TypeError("Invalid note operation");}
});

export function note(message,title,write=process.stdout.write.bind(process.stdout)){
  invoke("note",[message,title,write]);
}
