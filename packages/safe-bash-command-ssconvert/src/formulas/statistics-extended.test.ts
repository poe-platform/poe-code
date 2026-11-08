import { expect, it } from 'vitest';
import { recalculateWorkbook } from './evaluator.js';
import type { CapabilityContext } from '../contracts.js';
import type { CellValue } from '../workbook.js';
const context: CapabilityContext = { signal:new AbortController().signal, environment:{env:{},locale:'C',timezone:'UTC'}, limits:{inputBytes:100000,outputBytes:100000,cells:10000,sheets:2,operations:10000,workbookWork:1000000},own(){} };
function run(formula:string): CellValue { return recalculateWorkbook({sheets:[{id:'s',name:'Sheet',cells:[{row:10,column:10,value:{kind:'number',value:0},formula,formulaDirty:true},...Array.from({length:3},(_,row) => [{row,column:0,value:{kind:'number' as const,value:row+1}},{row,column:1,value:{kind:'number' as const,value:row+1}}]).flat()]}]},context).sheets[0]!.cells[0]!.value; }
it.each([
 ['=LANDAU(0)',.1788541609], ['=OWENT(0,1)',.125], ['=R.PSNORM(0,1,0,1)',.25],
 ['=R.DSNORM(0,1,0,1)',1 / Math.sqrt(2 * Math.PI)], ['=R.PST(0,1,1)',.25],
 ['=R.PTUKEY(0,2,10)',0], ['=INTERPOLATION({1;2;3},{10;20;20},1.5)',15],
 ['=INDEX(HPFILTER({1;2;3;4;5;6},0),1,1)',1],
 ['=INDEX(LINEST({3;5;7},{1;2;3}),1,1)',2], ['=INDEX(TREND({3;5;7},{1;2;3},{4;5}),1,1)',9],
 ['=TTEST(A1:A3,B1:B3,2,2)',1], ['=CHITEST({10;10},{10;10})',1],
 ['=INDEX(ADTEST({1;2;3}),3,1)',3], ['=CRONBACH({1;2;3},{2;4;6})',8 / 9],
] as [string,number][])("implements %s",(formula, expected) => { const actual=run(formula);expect(actual.kind).toBe('number');if(actual.kind==='number') expect(Math.abs(actual.value-expected)).toBeLessThanOrEqual(1e-10); });
it('selects the first simulation value in a regular conversion',()=>expect(run('=SIMTABLE(5,6,7)')).toEqual({kind:'number',value:5}));
