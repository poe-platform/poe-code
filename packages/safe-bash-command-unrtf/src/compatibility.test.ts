import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRtf, UnrtfError, type UnrtfLimits } from './index.js';

// Independent GNU 0.21.10 controls are recorded in docs/plans/compatibility-unrtf.md.
// These expectations qualify the declared strict profile, including deliberate differences.
const limits: UnrtfLimits = {retainedBytes:300000,images:100,imageBytes:100000,inputBytes:300000,binaryBytes:100000,tokenBytes:1024,tokens:200000,depth:100,decodedBytes:300000,outputBytes:300000,work:2000000};
async function observe(input:Uint8Array, size:number, overrides:Partial<UnrtfLimits> = {}) {
  let closed = false;
  async function* source() {
    try { for (let i=0;i<input.length;i+=size) yield input.subarray(i,i+size); }
    finally { closed = true; }
  }
  const bytes:number[] = [];
  let error:unknown;
  try {
    for await (const chunk of renderRtf(source(), {format:'text',limits:{...limits,...overrides},signal:new AbortController().signal})) bytes.push(...chunk);
  } catch (failure) { error = failure; }
  assert.equal(closed,true);
  return {bytes:Uint8Array.from(bytes),error};
}
const encode = (text:string) => new TextEncoder().encode(text);

test('independent text controls distinguish strict Unicode from native low-byte/token output', async () => {
  for (const [input,expected] of [
    ['{\\rtf1 A{\\b B{\\i C}D}E}','ABCDE'],
    ['{\\rtf1\\uc0\\u945 abX}','αabX'],
    ['{\\rtf1\\uc1\\u945 abX}','αbX'],
    ['{\\rtf1\\uc2\\u945 abX}','αX'],
    ["{\\rtf1\\ansicpg1251\\'c0{\\ansicpg1252\\'80}\\'c0}",'А€А'],
    ['{\\rtf1\\trowd A\\cell B\\cell\\row}','A\tB\t\n'],
    ['{\\rtf1 A{\\*\\unknown SECRET}Z}','AZ'],
  ]) for (const size of [1,7,2048]) {
    const result = await observe(encode(input!),size);
    assert.equal(result.error,undefined);
    assert.deepEqual(result.bytes,encode(expected!));
  }
});

test('original native binary threshold lengths preserve suffix with exact raw consumption', async () => {
  for (const length of [0,1,4,2000,2020,2030,2040,2048,2050,4096,8192]) {
    const prefix=encode('{\\rtf1 BEFORE\\bin'+length+' '),suffix=encode('AFTER}');
    const input=new Uint8Array(prefix.length+length+suffix.length);
    input.set(prefix);input.fill(65,prefix.length,prefix.length+length);input.set(suffix,prefix.length+length);
    for (const size of [7,2047,2049]) {
      const result=await observe(input,size);
      assert.equal(result.error,undefined);
      assert.deepEqual(result.bytes,encode('BEFOREAFTER'));
    }
    const denied=await observe(input,7,{binaryBytes:Math.max(0,length-1)});
    if (length) assert.ok(denied.error instanceof UnrtfError && denied.error.resource === 'binaryBytes');
    else assert.equal(denied.error,undefined);
  }
});

test('strict malformed controls return exact prefixes and fail instead of native successful recovery', async () => {
  for (const [input,prefix] of [['PLAIN',''],['{\\rtf1 PREFIX','PREFIX'],["{\\rtf1\\'xz}",''],['{\\rtf1 BEFORE\\bin4 x','BEFORE']]) {
    const result=await observe(encode(input!),1);
    assert.ok(result.error instanceof UnrtfError && result.error.code==='E_PARSE');
    assert.deepEqual(result.bytes,encode(prefix!));
  }
  const bounded=await observe(encode('{\\rtf1 '+'{'.repeat(101)+'X'+'}'.repeat(102)),7);
  assert.ok(bounded.error instanceof UnrtfError && bounded.error.resource==='depth');
});

for (const count of [10237,10238,10239]) for (const tail of ["\\'82\\'a0","\\'82","\\'82\\b\\'a0"]) {
  test('upstream decoder neighbor '+count+' / '+tail+' preserves valid prefixes', async () => {
    const result=await observe(encode("{\\rtf1\\ansicpg932 "+"\\'41".repeat(count)+tail+'}'),2048);
    const incomplete=tail==="\\'82";
    assert.deepEqual(result.bytes,encode('A'.repeat(count)+(incomplete?'':'あ')));
    if (incomplete) assert.ok(result.error instanceof UnrtfError && result.error.code==='E_ENCODING');
    else assert.equal(result.error,undefined);
  });
}
