import { expect, it } from 'vitest';
import { parseExpression } from './parser.js';
import { serializeExpression } from './serialization.js';
import { excelGrammar, gnumericGrammar, odfGrammar } from './conventions.js';
import type { FormulaGrammar } from './ast.js';
const position = {sheet:'s',row:0,column:0};
it.each<[FormulaGrammar,string,string]>([
 [excelGrammar,'=_xlfn.NORM.DIST(1,0,1,TRUE)','NORMDIST'],
 [excelGrammar,'=_xlfn.STDEV.S(1,2)','STDEV'],
 [odfGrammar,'of:=LEGACY.TDIST(1;2;2)','TDIST'],
 [odfGrammar,'of:=COM.MICROSOFT.COVARIANCE.P(1;2)','COVAR'],
])('imports released statistical spelling %#',(grammar,source,name)=> { const parsed=parseExpression(source,{grammar,position}); expect(parsed.ok && parsed.document.root.kind==='call' && parsed.document.root.name).toBe(name); });
it.each<[string,FormulaGrammar,string]>([
 ['=NORMDIST(1,0,1,TRUE)',excelGrammar,'=_xlfn.NORM.DIST(1,0,1,TRUE)'],
 ['=TDIST(1,2,2)',odfGrammar,'of:=LEGACY.TDIST(1;2;2)'],
 ['=ADTEST(A1:A10)',excelGrammar,'=_xlfngnumeric.ADTEST(A1:A10)'],
 ['=R.QNORM(0.3,1,2)',excelGrammar,'=_xlfn.NORM.INV(0.3,1,2)'],
 ['=R.QCHISQ(0.3,2,0)',excelGrammar,'=_xlfn.CHISQ.INV.RT(0.3,2)'],
 ['=R.QBINOM(0.3,8,0.4)',excelGrammar,'=_xlfn.BINOM.INV(8,0.4,0.3)'],
 ['=INTERPOLATION(A1:A3,B1:B3,2)',gnumericGrammar,'=interpolation(A1:A3,B1:B3,2)'],
 ['=R.DCHISQ(2,4)',odfGrammar,'of:=CHISQDIST(2;4;FALSE())'],
 ['=R.PCHISQ(2,4)',odfGrammar,'of:=CHISQDIST(2;4)'],
 ['=R.QCHISQ(0.3,4)',odfGrammar,'of:=CHISQINV(0.3;4)'],
 ['=R.PCHISQ(2,4,FALSE)',odfGrammar,'of:=ORG.GNUMERIC.R.PCHISQ(2;4;FALSE())'],
])('exports released statistical spelling %s',(source,grammar,expected)=> { const parsed=parseExpression(source,{position}); if(!parsed.ok)throw new Error('Fixture parse failed');expect(serializeExpression(parsed.document,grammar,false,true)).toBe(expected); });

it.each([
 ['=_xlfn.BINOM.INV(8,0.4,0.3)','=R.QBINOM(0.3,8,0.4)'],
 ['=_xlfn.CHISQ.DIST(2,4,TRUE)','=R.PCHISQ(2,4)'],
 ['=_xlfn.F.DIST(2,4,6,FALSE)','=R.DF(2,4,6)'],
 ['=_xlfn.T.DIST(2,4,A1)','=IF(A1,R.PT(2,4),R.DT(2,4))'],
 ['=_xlfn.LOGNORM.DIST(2,0,1,TRUE)','=R.PLNORM(2,0,1)'],
 ['=_xlfn.NEGBINOM.DIST(2,4,0.3,FALSE)','=R.DNBINOM(2,4,0.3)'],
])('imports released statistical argument handler %s',(source,expected)=> {
 const parsed=parseExpression(source,{grammar:excelGrammar,position});
 if(!parsed.ok)throw new Error('Fixture parse failed');
 expect(serializeExpression(parsed.document,gnumericGrammar,false)).toBe(expected);
});
it.each([
 ['of:=CHISQDIST(2;4)','=R.PCHISQ(2,4)'],
 ['of:=CHISQDIST(2;4;FALSE())','=R.DCHISQ(2,4)'],
 ['of:=COM.MICROSOFT.F.DIST(2;4;6;TRUE())','=R.PF(2,4,6)'],
 ['of:=COM.MICROSOFT.LOGNORM.DIST(2;0;1;TRUE())','=LOGNORMDIST(2,0,1)'],
 ['of:=COM.MICROSOFT.NEGBINOM.DIST(2;4;0.3;FALSE())','=NEGBINOMDIST(2,4,0.3)'],
 ['of:=COM.MICROSOFT.T.DIST(2;4;TRUE())','=R.PT(2,4)'],
 ['of:=COM.MICROSOFT.T.DIST.RT(2;4)','=TDIST(2,4,1)'],
 ['of:=COM.MICROSOFT.T.DIST.2T(2;4)','=TDIST(2,4,2)'],
 // Released reader reverses these NORM.S.DIST branches.
 ['of:=COM.MICROSOFT.NORM.S.DIST(2;TRUE())','=R.DNORM(2,0,1)'],
])('imports released OpenFormula argument handler %s',(source,expected)=> {
 const parsed=parseExpression(source,{grammar:odfGrammar,position});
 if(!parsed.ok)throw new Error('Fixture parse failed');
 expect(serializeExpression(parsed.document,gnumericGrammar,false)).toBe(expected);
});
