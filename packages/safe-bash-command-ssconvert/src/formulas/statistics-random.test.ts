import { expect, it } from 'vitest';
import { recalculateWorkbook } from './evaluator.js';
import type { CapabilityContext } from '../contracts.js';
const formulas = [
 '=RAND()', '=RANDBERNOULLI(0.4)', '=RANDBETA(2,3)', '=RANDBETWEEN(2,8)', '=RANDBINOM(0.4,8)',
 '=RANDCAUCHY(2)', '=RANDCHISQ(4)', '=RANDDISCRETE({2;4;8},{0.2;0.3;0.5})', '=RANDEXP(2)',
 '=RANDEXPPOW(2,3)', '=RANDFDIST(4,6)', '=RANDGAMMA(2,3)', '=RANDNORM(2,3)', '=RANDNORMTAIL(2,3)',
 '=RANDGEOM(0.4)', '=RANDGUMBEL(2,3)', '=RANDHYPERG(4,6,3)', '=RANDLANDAU()', '=RANDLAPLACE(2)',
 '=RANDLEVY(2,1.5,0.3)', '=RANDLOG(0.4)', '=RANDLOGISTIC(2)', '=RANDLOGNORM(2,3)', '=RANDNEGBINOM(0.4,3)',
 '=RANDPARETO(3,2)', '=RANDPOISSON(3)', '=RANDRAYLEIGH(2)', '=RANDRAYLEIGHTAIL(2,3)', '=RANDSNORM(2,3,4)',
 '=RANDSTDIST(4,2)', '=RANDTDIST(4)', '=RANDUNIFORM(2,8)', '=RANDWEIBULL(2,3)', '=SIMTABLE(2,4,8)'
];
function context(seed: number): CapabilityContext {
 return { signal:new AbortController().signal, environment:{env:{},locale:'C',timezone:'UTC'},
 limits:{inputBytes:100000,outputBytes:100000,cells:1000,sheets:2,operations:100000,workbookWork:100000}, own(){},
 random:{next(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}} };
}
function run(formula: string, supplied: CapabilityContext) {
 return recalculateWorkbook({sheets:[{id:'s',name:'Sheet',cells:[{row:0,column:0,value:{kind:'number',value:0},formula,formulaDirty:true}]}]},supplied).sheets[0]!.cells[0]!.value;
}
it.each(formulas)('replays an injected stream independently for %s', formula => {
 const a=context(17), b=context(17), unrelated=context(91);
 const first=run(formula,a);
 expect(first.kind).toBe('number');
 if(first.kind==='number')expect(Number.isFinite(first.value)).toBe(true);
 run('=RANDNORM(0,1)',unrelated);
 expect(run(formula,b)).toEqual(first);
 expect(run(formula,b)).toEqual(run(formula,a));
});
it('bounds an adversarial rejection stream instead of hanging',()=> {
 const supplied={...context(17),random:{next:()=>.5},limits:{...context(17).limits,workbookWork:50}};
 expect(()=>run('=RANDNORM(0,1)',supplied)).toThrow('work limit');
});
it('observes cancellation triggered inside the random capability',()=> {
 const abort=new AbortController();
 const supplied={...context(17),signal:abort.signal,random:{next(){abort.abort(new Error('random cancelled'));return .5;}}};
 expect(()=>run('=RANDNORM(0,1)',supplied)).toThrow('random cancelled');
});
it('requires explicit randomness and rejects invalid capability values',()=> {
 const {random:ignoredRandom,...supplied}=context(17);
 expect(()=>run('=RAND()',supplied)).toThrow('explicit random source');
 for(const value of [-1,1,NaN,Infinity])expect(()=>run('=RAND()',{...supplied,random:{next:()=>value}})).toThrow('Invalid ssconvert random result');
});
