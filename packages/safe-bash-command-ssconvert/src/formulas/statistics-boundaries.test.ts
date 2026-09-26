import { expect, it } from 'vitest';
import { recalculateWorkbook } from './evaluator.js';
import type { CapabilityContext } from '../contracts.js';
const context:CapabilityContext={signal:new AbortController().signal,environment:{env:{},locale:'C',timezone:'UTC'},limits:{inputBytes:100000,outputBytes:100000,cells:1000,sheets:2,operations:100000,workbookWork:100000},own(){}};
function run(formula:string){return recalculateWorkbook({sheets:[{id:'s',name:'Sheet',cells:[{row:0,column:0,value:{kind:'number',value:0},formula,formulaDirty:true}]}]},context).sheets[0]!.cells[0]!.value;}
it('matches the captured contracted inverse-normal log-tail polynomial',()=>expect(run('=R.QNORM(-1000,0,1,TRUE,TRUE)')).toEqual({kind:'number',value:Number('-44.615747731966614')}));
it.each(['BINOM(0,8,.3)','GEOM(0,.3)','HYPER(0,7,5,4)','NBINOM(0,3,.4)','POIS(0,3)'])('preserves upper-log discrete lower endpoints %s',arguments_=>expect(run('=R.Q'+arguments_.slice(0,-1)+',FALSE,TRUE)')).toEqual({kind:'number',value:0}));
it.each(['=R.QCAUCHY(1,1,2)','=R.QCAUCHY(0,1,2,FALSE,TRUE)','=R.QNBINOM(-1000,3,.4,TRUE,TRUE)','=R.QNBINOM(-1000,3,.4,FALSE,TRUE)','=R.PLNORM(0,.5,.7,FALSE,TRUE)'])('preserves released tail error %s',formula=>expect(run(formula)).toEqual({kind:'error',value:'#NUM!'}));
it.each(['=R.PNORM(-38,0,1)','=R.PLNORM(0,.5,.7,FALSE)','=R.PHYPER(1000000,7,5,4,TRUE,TRUE)','=R.PHYPER(-1,7,5,4,FALSE,TRUE)'])('preserves released exact zero tail %s',formula=>expect(run(formula)).toEqual({kind:'number',value:0}));
it('keeps the large Cauchy log lower tail stable',()=>{
 const result=run('=R.PCAUCHY(1000000,1,2,TRUE,TRUE)');expect(result.kind).toBe('number');if(result.kind==='number')expect(Math.abs(result.value-Number('-6.3662061163e-7'))).toBeLessThan(1e-20);
});
it('uses the released Student-t inverse expansion after probability underflow',()=>{
 const actual=run('=R.QT(-1000,5,TRUE,TRUE)');expect(actual.kind).toBe('number');if(actual.kind==='number')expect(Math.abs(actual.value/Number('-1.1333163510624135e87')-1)).toBeLessThan(2e-13);
});
it.each([
 ['=OFFTRAF(0,30)',0], ['=R.PEXP(2,0)',1], ['=R.QEXP(0.3,0)',0], ['=R.QCAUCHY(0.3,1,0)',1],
 ['=R.QGAMMA(0.3,2,-1)',-1.0973492107034915], ['=R.QGAMMA(0.3,2,0)',0],
 ['=EXPPOWDIST(2,-1,1.5)',-.03273666837339508], ['=SNORM.DIST.RANGE(1000000,9)',-1.1285884059538408e-19],
 ['=SNORM.DIST.RANGE(8,-1)',-.8413447460685423], ['=SNORM.DIST.RANGE(8,0)',-.4999999999999994]
] as [string,number][] )('preserves released boundary %s',(formula,expected)=>{
 const actual=run(formula);expect(actual.kind).toBe('number');if(actual.kind==='number')expect(Math.abs(actual.value-expected)).toBeLessThanOrEqual(Math.max(Number.MIN_VALUE,Math.abs(expected)*2e-13));
});
it.each(['=R.DLNORM(2,0.5,0)','=R.PLNORM(2,0.5,0)','=R.QCHISQ(0.3,0)','=R.QGAMMA(0.3,0,3)',
 '=BETADIST(.3,-1,3)','=BETADIST(.3,0,3)','=BETADIST(.3,2,-1)','=BETADIST(.3,2,0)',
 '=BETA.DIST(.3,0,3,FALSE)','=BETA.DIST(.3,2,0,FALSE)','=BETAINV(.3,0,3)','=BETAINV(.3,2,0)',
 '=GAMMAINV(.3,2,-1)','=GAMMAINV(.3,2,0)'])('preserves released boundary error %s',formula=>expect(run(formula)).toEqual({kind:'error',value:'#NUM!'}));
