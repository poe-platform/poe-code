import {parseBlockDocument} from "./markdown-block.js";

export function parse(markdown) {
  const {frontmatter,frontmatterRange,children}=parseBlockDocument(markdown);
  let nodes=children;
  if(frontmatter!==undefined){
    const node={type:"frontmatter",data:frontmatter};
    if(frontmatterRange!==undefined)Object.defineProperty(node,"range",{value:frontmatterRange,enumerable:false,configurable:true,writable:true});
    nodes=[node,...children];
  }
  const ast={type:"root",children:nodes};
  Object.defineProperty(ast,"range",{value:{start:0,end:Buffer.byteLength(markdown,"utf8")},enumerable:false,configurable:true,writable:true});
  return {...(frontmatter===undefined?{}:{frontmatter}),ast};
}
