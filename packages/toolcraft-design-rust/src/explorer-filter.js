import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {graphemes} from "./graphemes.js";
import {stripAnsi} from "./explorer-text.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const project=createComponentPolicy(native.designExplorerProjectPolicy,{
  nextLengths(iterator){
    const next=iterator.next();
    if(next.done)return [];
    const foldedLength=next.value.toLocaleLowerCase().length;
    return [next.value.length,foldedLength];
  }
});

export function filterRows(query,rows,opts={}){
  if(query.trim().length===0)return rows.map((_,index)=>({index,score:0,positions:[]}));
  const preparedQuery=opts.caseSensitive===true?query:query.toLocaleLowerCase();
  const matches=[];
  rows.forEach((row,index)=>{
    const text=[row.title,row.subtitle].filter(value=>value!==undefined).map(stripAnsi).join(" ");
    const preparedText=opts.caseSensitive===true?text:text.toLocaleLowerCase();
    const match=native.designExplorerMatch(Array.from(preparedQuery),Array.from(preparedText));
    if(match!=null)matches.push({index,...match,positions:text===preparedText?match.positions:project("project",[match.positions,graphemes(text)[Symbol.iterator]()])});
  });
  return matches.sort((left,right)=>right.score-left.score||left.index-right.index);
}
