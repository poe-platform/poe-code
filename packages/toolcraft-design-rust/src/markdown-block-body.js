import {createRequire} from "node:module";
import {classifyMarkdownUnit} from "./markdown-characters.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
let depth=0;

// Internal body parser; document/frontmatter and public Markdown wrappers follow.
export function parseBlockBody(input,offset=0,preferList=false) {
  if(depth>=128)throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try {
    let failed=false,failure;
    const classify=text=>{
      try {return {flags:classifyMarkdownUnit(text),error:false};}
      catch(error){failed=true;failure=error;return {flags:0,error:true};}
    };
    let nodes;
    try {nodes=native.designParseMarkdownBlockBody(input,offset,!!preferList,classify);}
    catch(error){
      if(failed)throw failure;
      if(error.message==="Maximum call stack size exceeded")throw new RangeError(error.message);
      throw error;
    }
    const pending=[...nodes];
    while(pending.length){
      const node=pending.pop();
      Object.defineProperty(node,"range",{value:node.range,enumerable:false,configurable:true,writable:true});
      if(node.children)for(const child of node.children)pending.push(child);
    }
    return nodes;
  } finally {depth--;}
}
