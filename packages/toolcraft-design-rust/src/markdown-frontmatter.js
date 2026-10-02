import {FrontmatterParseError,parseFrontmatter} from "./frontmatter/index.js";

export function extractFrontmatter(markdown) {
  let parsed;
  try {parsed=parseFrontmatter(markdown);}
  catch(error){
    if(error instanceof FrontmatterParseError&&error.message==="Missing YAML frontmatter end delimiter (---).")return {body:markdown};
    throw error;
  }
  if(parsed.body===markdown&&Object.keys(parsed.frontmatter).length===0)return {body:markdown};
  const result={frontmatter:parsed.frontmatter,body:parsed.body};
  if(result.frontmatter!==undefined)Object.defineProperty(result,"range",{
    value:{start:0,end:Buffer.byteLength(markdown.slice(0,markdown.length-parsed.body.length),"utf8")},
    enumerable:false,configurable:true,writable:true
  });
  return result;
}
