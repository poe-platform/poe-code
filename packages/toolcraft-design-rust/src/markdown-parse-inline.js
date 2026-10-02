import {createRequire} from "node:module";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
// Character properties stay with the JS runtime's Unicode version; no regex engine
// or Unicode package is added to the native scanner or matcher.
const whitespace=/\s/u,punctuation=/[\p{P}\p{S}]/u;
let depth=0;

export function parseInline(raw,options={}) {
  if(depth>=128)throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try {
    const footnoteLabels=options.footnoteLabels;
    const literal=options.allowLiteralAutolinks??true;
    const maps=[options.offsets??native.designScanMarkdown("createOffsetMap",raw,options.offset??0)];
    const ranges=[];
    let failed=false,failure;
    const callback=(operation,a,b,c,d,text)=>{
      try {
        let handle=0,flags=0;
        switch(operation){
          case 0: {
            const offsets=maps[a];
            const start=d?(offsets[b]??0):(offsets[b]??offsets[offsets.length-1]??0);
            const end=offsets[c]??offsets[offsets.length-1]??0;
            handle=ranges.push({start,end})-1;
            break;
          }
          case 1: handle=maps.push(maps[a].slice(b,c+1)??native.designScanMarkdown("createOffsetMap",text,0))-1;break;
          case 2: handle=ranges.push({start:Math.min(ranges[a].start,ranges[b].start),end:Math.max(ranges[a].end,ranges[b].end)})-1;break;
          case 3: handle=ranges.push({start:ranges[a]?.start??c,end:ranges[b]?.end??d})-1;break;
          case 4: flags=Number(!!footnoteLabels.has(text));break;
          case 5: flags=Number(text===""||whitespace.test(text))|Number(text!==""&&punctuation.test(text))*2;break;
        }
        return {handle,flags,error:false};
      } catch(error) {failed=true;failure=error;return {handle:0,flags:0,error:true};}
    };
    let nodes;
    try {nodes=native.designParseMarkdownInline(raw,!!literal,footnoteLabels!==undefined,callback);}
    catch(error){
      if(failed)throw failure;
      if(error.message==="Maximum call stack size exceeded")throw new RangeError(error.message);
      throw error;
    }
    const pending=[...nodes];
    while(pending.length){
      const node=pending.pop();
      Object.defineProperty(node,"range",{value:ranges[node.range],enumerable:false,configurable:true,writable:true});
      if(node.children)for(const child of node.children)pending.push(child);
    }
    return nodes;
  } finally {depth--;}
}
