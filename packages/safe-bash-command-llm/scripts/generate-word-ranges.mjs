import {readFile,writeFile} from 'node:fs/promises';
const {ranges}=JSON.parse(await readFile(new URL('../src/fixtures/word-ranges-python3.9.6.json',import.meta.url),'utf8'));
let previous=0;
const encoded=ranges.map(([start,end])=>{
 const pair=(start-previous).toString(36)+','+(end-start).toString(36);
 previous=end;return pair;
}).join(';');
const contents=`// Generated from the complete Python 3.9.6 / Unicode 13 word classification capture.
// Pairs encode the gap from the previous end and the inclusive range length in base 36.
export const wordRanges:readonly (readonly [number,number])[]=/* @__PURE__ */ (()=>{
 let end=0;
 return ${JSON.stringify(encoded)}.split(';').map(pair=>{
  const [gap,length]=pair.split(',').map(value=>parseInt(value,36));
  const start=end+gap!;end=start+length!;
  return [start,end] as const;
 });
})();
`;
const output=new URL('../src/word-ranges.ts',import.meta.url);
if(process.argv.includes('--check')){
 if(await readFile(output,'utf8')!==contents)throw new Error('Word ranges are stale; run npm run generate:word-ranges');
}else await writeFile(output,contents);
