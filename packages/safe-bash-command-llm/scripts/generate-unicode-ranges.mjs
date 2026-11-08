import {readFile,writeFile} from 'node:fs/promises';
const alphabet="0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!#",markers="$%&()*+,-./:;<=>?@[]^`{}~",fragments=["20", "12", "13", "40", "30", "80", "22", "10", "26", "50", "21", "23", "17", "11", "1b", "24", "33", "14", "29", "60", "19", "15", "18", "0(", "2o2"];
const {ranges}=JSON.parse(await readFile(new URL('../src/fixtures/word-ranges-python3.9.6.json',import.meta.url),'utf8'));
const {excluded}=JSON.parse(await readFile(new URL('../src/fixtures/printable-ranges-python3.9.6.json',import.meta.url),'utf8'));
const encode=values=>{
 let previous=0,result='';
 for(const point of values){let gap=point-previous;previous=point;while(gap>=32){result+=alphabet[gap%32+32];gap=Math.floor(gap/32);}result+=alphabet[gap];}
 return result;
};
let packed=encode(ranges.flat())+'|'+encode(excluded.flat());
// Fixed lossless fragments are independent of the captured range values.
fragments.forEach((text,index)=>{packed=packed.split(text).join(markers[index]);});
const common=`// Generated from the complete Python 3.9.6 / Unicode 13 captures.
// Five-bit continuation integers and reversible fixed fragments preserve every boundary.
const ranges=/* @__PURE__ */ (()=>{
 let packed=${JSON.stringify(packed)};
 const markers=${JSON.stringify(markers)},fragments=${JSON.stringify(fragments.join('~'))}.split('~');
 for(let index=fragments.length;index--;)packed=packed.split(markers[index]!).join(fragments[index]!);
 return packed.split('|');
})();
export function decodeUnicodeRanges(index:0|1):number[]{
 const result:number[]=[],alphabet=${JSON.stringify(alphabet)};let point=0,value=0,shift=0;
 for(const char of ranges[index]!){const digit=alphabet.indexOf(char);value+=(digit&31)*2**shift;if(digit<32){result.push(point+=value);value=0;shift=0;}else shift+=5;}
 return result;
}
`;
const word=`// Generated from the complete Python 3.9.6 / Unicode 13 word capture.
import {decodeUnicodeRanges} from './unicode-ranges.js';
export const wordRanges:readonly (readonly [number,number])[]=/* @__PURE__ */ (()=>{
 const values=decodeUnicodeRanges(0),ranges:Array<readonly [number,number]>=[];
 for(let index=0;index<values.length;index+=2)ranges.push([values[index]!,values[index+1]!]);
 return ranges;
})();
`;
const printable=`// Generated from the complete Python 3.9.6 / Unicode 13 printability capture.
import {decodeUnicodeRanges} from './unicode-ranges.js';
export const excluded:readonly number[]=/* @__PURE__ */ decodeUnicodeRanges(1);
`;
for(const [name,contents] of [['unicode-ranges',common],['word-ranges',word],['printable-ranges',printable]]){
 const output=new URL('../src/'+name+'.ts',import.meta.url);
 if(process.argv.includes('--check')){if(await readFile(output,'utf8')!==contents)throw new Error(name+' is stale; run npm run generate:word-ranges');}
 else await writeFile(output,contents);
}
