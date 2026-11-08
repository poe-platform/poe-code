import {createRequire} from "node:module";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
export const STYLE_BOLD=1,STYLE_DIM=2,STYLE_UNDERLINE=4,STYLE_INVERSE=8;

export function packStyle(style) {
  return native.designPackStyle(!!style.bold,!!style.dim,!!style.underline,!!style.inverse,(style.fg??0)&255,(style.bg??0)&255);
}
export function foreground(style) {return native.designStyleChannel(style|0,false);}
export function background(style) {return native.designStyleChannel(style|0,true);}
export function styleToSgrDelta(previous,next,colors=process.env.NO_COLOR===undefined&&process.env.TERM!=="dumb") {
  if(!colors||previous===next)return "";
  const codes=[];
  if(typeof previous==="number"&&typeof next==="number") {
    const planned=native.designStyleCodes(previous|0,next|0);
    for(let i=0;i<planned.length;i++)codes.push(planned[i]);
  } else {
    let failed=false,failure;
    const host=(operation,code)=>{
      try {
        let value=0;
        if(operation===2)codes.push(code);
        else value=(operation===0?previous:next)|0;
        return {value,failed:false};
      } catch(error){failed=true;failure=error;return {value:0,failed:true};}
    };
    try{native.designStyleEmit(host);}catch(error){if(failed)throw failure;throw error;}
  }
  return codes.length===0?"":`\u001b[${[...new Set(codes)].join(";")}m`;
}
