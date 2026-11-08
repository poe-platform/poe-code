// Generated from the complete Python 3.9.6 / Unicode 13 word capture.
import {decodeUnicodeRanges} from './unicode-ranges.js';
export const wordRanges:readonly (readonly [number,number])[]=/* @__PURE__ */ (()=>{
 const values=decodeUnicodeRanges(0),ranges:Array<readonly [number,number]>=[];
 for(let index=0;index<values.length;index+=2)ranges.push([values[index]!,values[index+1]!]);
 return ranges;
})();
