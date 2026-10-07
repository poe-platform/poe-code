import {readFile,writeFile} from 'node:fs/promises';
const {excluded}=JSON.parse(await readFile(new URL('../src/fixtures/printable-ranges-python3.9.6.json',import.meta.url),'utf8'));
let previous=0;
const encoded=excluded.flat().map(point=>{const gap=point-previous;previous=point;return gap.toString(36);}).join(',');
const contents=`// Generated from the complete Python 3.9.6 / Unicode 13 printability capture.
// Each base-36 value is the delta from the previous inclusive range boundary.
export const excluded:readonly number[]=/* @__PURE__ */ (()=>{
 let point=0;
 return ${JSON.stringify(encoded)}.split(',').map(gap=>point+=parseInt(gap,36));
})();
`;
const output=new URL('../src/printable-ranges.ts',import.meta.url);
if(process.argv.includes('--check')){
 if(await readFile(output,'utf8')!==contents)throw new Error('Printable ranges are stale; run npm run generate:printable-ranges');
}else await writeFile(output,contents);
