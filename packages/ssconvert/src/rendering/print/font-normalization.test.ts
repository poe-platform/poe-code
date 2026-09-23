import {it as test} from 'vitest';
import assert from 'node:assert/strict';
import {normalizeFontText} from './font-normalization.js';
const chars=(text:string)=>new Set([...text].map(scalar=>scalar.codePointAt(0)!));
const cases=[
  ['Latin composition','A\u0301','A\u0301Á','Á'],
  ['missing final glyph','A\u030a\u0301','A\u030a\u0301Å','Å\u0301'],
  ['missing intermediate glyph','A\u030a\u0301','A\u030a\u0301Ǻ','A\u030a\u0301'],
  ['missing input mark','A\u0301','AÁ','Á'],
  ['unsupported singleton decomposition','Ǻ','A\u030a\u0301Å','Å\u0301'],
  ['supported singleton stays intact','Ǻ','Ǻ','Ǻ'],
  ['partial decomposition needs second glyph','Ǻ','AÅ','Ǻ'],
  ['canonical mark order','a\u0302\u0323','a\u0302\u0323ạậ','ậ'],
  ['equal classes preserve blocking','a\u0301\u0300','a\u0301\u0300áà','á\u0300'],
  ['equal class with unavailable first composite','a\u0301\u0300','a\u0301\u0300à','a\u0301\u0300'],
  ['Greek composition','ι\u0308\u0301','ι\u0308\u0301ϊΐ','ΐ'],
  ['Cyrillic composition','и\u0306','и\u0306й','й'],
  ['CGJ blocks composition','a\u034f\u0301','a\u034f\u0301á','a\u034f\u0301'],
  ['variation selector stays between base and mark','A\ufe0f\u0301','A\ufe0f\u0301Á','A\ufe0f\u0301'],
  ['supplementary variation selector','A\u{e0100}\u0301','A\u{e0100}\u0301Á','A\u{e0100}\u0301'],
  ['supported canonically equivalent singleton remains unchanged','Å','ÅÅA\u030a','Å'],
  ['unsupported canonically equivalent singleton decomposes','Å','ÅA\u030a','Å'],
  ['other shaper scripts remain unchanged','ا\u0654','ا\u0654أ','ا\u0654'],
  ['unqualified marks keep their whole cluster unchanged','A\u093c\u0301','A\u093c\u0301Á','A\u093c\u0301'],
  ['unpaired UTF16 and neighbors remain intact','\ud800A\u0301','\ud800A\u0301Á','\ud800Á'],
  ['unrelated neighboring ligature text stays intact','office A\u0301','office A\u0301Á','office Á'],
] as const;
for(const [name,input,coverage,expected] of cases)test(name,()=>assert.equal(normalizeFontText(input,chars(coverage),()=>{}),expected));
for(const count of [32,33])test('reordering bound '+count,()=>{
  const marks='\u0301\u0323'.repeat(16)+(count===33?'\u0301':'');
  const expected=count===32?'Q'+'\u0323'.repeat(16)+'\u0301'.repeat(16):'Q'+marks;
  assert.equal(normalizeFontText('Q'+marks,chars('Q'+marks),()=>{}),expected);
});
test('cancellation reason is preserved during mark work',()=>{
  const reason={cancelled:true};let work=0;
  assert.throws(()=>normalizeFontText('A'+'\u0301'.repeat(100),chars('A\u0301Á'),amount=>{work+=amount??1;if(work>150)throw reason;}),error=>error===reason);
});
test('initial work admission precedes font coverage queries',()=>{
  const reason={limit:true};
  const coverage={has(){throw new Error('coverage must not be read');}} as unknown as ReadonlySet<number>;
  assert.throws(()=>normalizeFontText('A\u0301',coverage,()=>{throw reason;}),error=>error===reason);
});
