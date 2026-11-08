const segmenter=new Intl.Segmenter(undefined,{granularity:"grapheme"});
export function simpleGraphemes(value) {
  for(let index=0;index<value.length;index++) {
    const code=value.charCodeAt(index);
    if((code<32||code>126)&&code!==9&&code!==10&&(code<0x4e00||code>0x9fff))return false;
  }
  return true;
}
export function graphemes(value) {
  return simpleGraphemes(value)?value.split(""):Array.from(segmenter.segment(value),({segment})=>segment);
}
