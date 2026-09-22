import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRtf, UnrtfError, type UnrtfLimits } from './index.js';
import { Budget } from './contracts.js';
const limits: UnrtfLimits = {retainedBytes:300000,images:100,imageBytes:100000,inputBytes:300000,binaryBytes:100000,tokenBytes:1024,tokens:200000,depth:100,decodedBytes:300000,outputBytes:300000,work:2000000};
async function render(input:string, format:'text'|'html', overrides:Partial<UnrtfLimits> = {}) {
  async function* source() { for (const byte of new TextEncoder().encode(input)) yield Uint8Array.of(byte); }
  let result = '';
  for await (const bytes of renderRtf(source(), {format,limits:{...limits,...overrides},signal:new AbortController().signal})) result += new TextDecoder().decode(bytes);
  return result;
}
test('text preserves paragraph/tab/table boundaries without invented final newline', async () => {
  assert.equal(await render('{\\rtf1 A\\tab B\\par C\\line D\\trowd X\\cell Y\\cell\\row Z}', 'text'), 'A\tB\nC\nDX\tY\t\nZ');
});
test('HTML escapes body and restores nested styles', async () => {
  assert.equal(await render('{\\rtf1 <&>{\\b B{\\i I}B}N}', 'html'), '<!DOCTYPE html><html><body><p>&lt;&amp;&gt;<strong>B</strong><strong><em>I</em></strong><strong>B</strong>N</p></body></html>');
});
test('HTML paragraphs, line breaks and tables have explicit boundaries', async () => {
  assert.equal(await render('{\\rtf1 A\\tab B\\line C\\par D\\trowd X\\cell Y\\cell\\row Z}', 'html'), '<!DOCTYPE html><html><body><p>A&#9;B<br>C</p><p>D</p><table><tbody><tr><td>X</td><td>Y</td></tr></tbody></table><p>Z</p></body></html>');
});
test('plain resets styles locally; objects and field instructions stay inert', async () => {
  const html = await render('{\\rtf1\\b B{\\plain N}B{\\object EVIL}{\\field{\\*\\fldinst HYPERLINK "https://evil"}{\\fldrslt <label>}}}', 'html');
  assert.equal(html, '<!DOCTYPE html><html><body><p><strong>B</strong>N<strong>B</strong><strong>&lt;</strong><strong>l</strong><strong>a</strong><strong>b</strong><strong>e</strong><strong>l</strong><strong>&gt;</strong></p></body></html>');
});
test('expanded HTML output is bounded and incomplete tables fail explicitly', async () => {
  await assert.rejects(() => render('{\\rtf1 &}', 'html', {outputBytes:30}), (e:unknown) => e instanceof UnrtfError && e.resource === 'outputBytes');
  await assert.rejects(() => render('{\\rtf1\\trowd X}', 'html'), (e:unknown) => e instanceof UnrtfError && e.code === 'E_PARSE');
});
test('table boundaries cannot reorder an incomplete encoded character or surrogate', async () => {
  for (const format of ['text','html'] as const) {
    for (const boundary of ['cell','row','trowd']) {
      await assert.rejects(() => render("{\\rtf1\\ansicpg932\\trowd\\'41\\'82\\"+boundary+"\\'a0\\cell\\row}",format),
        (e:unknown) => e instanceof UnrtfError && e.code === 'E_ENCODING');
      await assert.rejects(() => render('{\\rtf1\\uc0\\trowd\\u-10179\\'+boundary+'\\u-8704\\cell\\row}',format),
        (e:unknown) => e instanceof UnrtfError && e.code === 'E_ENCODING');
    }
  }
});
test('font/color/size selection is scoped and declaration text never leaks', async () => {
  const html = await render('{\\rtf1{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red255\\green0\\blue16;}\\f0\\fs24\\cf1 A{\\cf0\\fs20 B}C}', 'html');
  assert.equal(html, '<!DOCTYPE html><html><body><p><span style="font-family:&#39;Arial&#39;;font-size:12pt;color:#ff0010">A</span><span style="font-family:&#39;Arial&#39;;font-size:10pt">B</span><span style="font-family:&#39;Arial&#39;;font-size:12pt;color:#ff0010">C</span></p></body></html>');
  await assert.rejects(() => render('{\\rtf1\\cf7 X}', 'html'), (e:unknown) => e instanceof UnrtfError && e.code === 'E_PARSE');
});
test('default font is resolved after its table and plain restores it locally', async () => {
  const html = await render('{\\rtf1\\deff0{\\fonttbl{\\f0 Arial;}{\\f1 Courier;}}A{\\f1 B\\plain C}D}', 'html');
  assert.equal(html, '<!DOCTYPE html><html><body><p><span style="font-family:&#39;Arial&#39;">A</span><span style="font-family:&#39;Courier&#39;">B</span><span style="font-family:&#39;Arial&#39;">C</span><span style="font-family:&#39;Arial&#39;">D</span></p></body></html>');
});
test('repeated empty paragraphs remain explicit', async () => {
  assert.equal(await render('{\\rtf1\\par\\par X}', 'html'), '<!DOCTYPE html><html><body><p></p><p></p><p>X</p></body></html>');
});
test('renderer closes an invocation source on output failure and is reentrant', async () => {
  let closed = false;
  async function* source() { try { yield new TextEncoder().encode('{\\rtf1 X}'); } finally { closed = true; } }
  await assert.rejects(async () => {
    for await (const chunk of renderRtf(source(), {format:'html',limits:{...limits,outputBytes:27},signal:new AbortController().signal})) void chunk;
  }, (e:unknown) => e instanceof UnrtfError && e.resource === 'outputBytes');
  assert.equal(closed,true);
  assert.deepEqual(await Promise.all([render('{\\rtf1\\b X}','html'),render('{\\rtf1 Y}','html')]), ['<!DOCTYPE html><html><body><p><strong>X</strong></p></body></html>','<!DOCTYPE html><html><body><p>Y</p></body></html>']);
});
test('font names cannot inject HTML attributes or CSS declarations', async () => {
  const html = await render('{\\rtf1{\\fonttbl{\\f0 A"<>&;}}\\f0 X}', 'html');
  assert.equal(html, '<!DOCTYPE html><html><body><p><span style="font-family:&#39;A\\22 \\3c \\3e \\26 &#39;">X</span></p></body></html>');
});
test('markup working storage is admitted before producing the initial HTML fragment', async () => {
  let pulled = false;
  async function* source() { pulled = true; yield new TextEncoder().encode('{\\rtf1 X}'); }
  const iterator = renderRtf(source(),{format:'html',limits:{...limits,retainedBytes:0},signal:new AbortController().signal});
  await assert.rejects(() => iterator.next(), (e:unknown) => e instanceof UnrtfError && e.resource === 'retainedBytes');
  assert.equal(pulled,false);
});
test('source acquisition failure emits no HTML and releases retained reservations', async () => {
  const failure = new Error('injected source failure');
  let closed = false;
  async function* source():AsyncGenerator<Uint8Array> {
    try { yield await Promise.reject<Uint8Array>(failure); } finally { closed = true; }
  }
  const options = {format:'html' as const,limits:{...limits},signal:new AbortController().signal};
  const budget = new Budget(options), emitted:Uint8Array[] = [];
  await assert.rejects(async () => {
    for await (const bytes of renderRtf(source(),options,budget)) emitted.push(bytes);
  },error => error === failure);
  assert.deepEqual(emitted,[]);
  assert.equal(closed,true);
  budget.charge('retainedBytes',limits.retainedBytes,0);
});
test('retained declaration and style reservations are released on success, return and failure', async () => {
  for (const mode of ['success','return','failure'] as const) {
    const options = {format:'html' as const,limits:{...limits},signal:new AbortController().signal};
    const budget = new Budget(options);
    async function* source() { yield new TextEncoder().encode('{\\rtf1{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red255;}\\f0{\\b X'+(mode === 'failure' ? '\\cf9' : '')+'}}'); }
    try {
      let count = 0;
      for await (const bytes of renderRtf(source(),options,budget)) {
        void bytes;
        if (mode === 'return' && ++count === 2) break;
      }
      assert.notEqual(mode,'failure');
    } catch (error) {
      assert.equal(mode,'failure');
      assert.ok(error instanceof UnrtfError && error.code === 'E_PARSE');
    }
    // A full new reservation fits only if no retained ownership remains.
    budget.charge('retainedBytes',limits.retainedBytes,0);
  }
});
test('literal replacement codepoint is content, unsupported pages are codec failures', async () => {
  assert.equal(await render("{\\rtf1\\ansicpg65001\\'ef\\'bf\\'bd}",'text'), '�');
  await assert.rejects(() => render('{\\rtf1\\ansicpg1361 X}','text'), (e:unknown) => e instanceof UnrtfError && e.code === 'E_CODEC');
});
test('additional admitted realm codecs have concrete Unicode byte fixtures', async () => {
  for (const [page,hex,expected] of [[874,'a1','ก'],[1250,'a5','Ą'],[1253,'c1','Α'],[1254,'d0','Ğ'],[1255,'e0','א'],[1256,'c7','ا'],[1257,'c0','Ą'],[1258,'d0','Đ'],[10000,'80','Ä']] as const)
    assert.equal(await render(`{\\rtf1\\ansicpg${page}\\'${hex}}`,'text'),expected);
});
