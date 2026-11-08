import {createRequire} from "node:module";
import {graphemes} from "./graphemes.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
export function ansiToCells(text) {
  let failed=false,failure;
  const segment=text=>{
    try{return {segments:graphemes(text),error:false};}
    catch(error){failed=true;failure=error;return {segments:[],error:true};}
  };
  try{
    const cells=native.designAnsiCells(text,segment),output=[];
    for(let index=0;index<cells.text.length;index++){
      const style=cells.styles[index];
      output.push({ch:cells.text[index],width:cells.widths[index],style,fg:(style>>8)&255,bg:(style>>16)&255});
    }
    return output;
  }
  catch(error){if(failed)throw failure;throw error;}
}
