import assert from 'node:assert/strict';
import test from 'node:test';
import { tokenizeRtf, extractRtf, UnrtfError, type UnrtfLimits } from './index.js';
const enc = new TextEncoder();
const limits: UnrtfLimits = { retainedBytes: 300000, images: 100, imageBytes: 100000, inputBytes: 300000, binaryBytes: 100000, tokenBytes: 1024, tokens: 200000, depth: 100, decodedBytes: 300000, outputBytes: 300000, work: 2000000 };
const options = () => ({ limits, signal: new AbortController().signal });
async function* chunks(input: string | Uint8Array, size = 7) {
  const bytes = typeof input === 'string' ? enc.encode(input) : input;
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}
async function text(input: string | Uint8Array, size = 7) {
  let result = '';
  for await (const event of extractRtf(chunks(input, size), options())) if (event.kind === 'text') result += event.text;
  return result;
}
async function failure(input: string, code: string, overrides: Partial<UnrtfLimits> = {}) {
  await assert.rejects(async () => {
    for await (const token of tokenizeRtf(chunks(input), { ...options(), limits: { ...limits, ...overrides } })) void token;
  }, (error: unknown) => error instanceof UnrtfError && error.code === code && Number.isSafeInteger(error.offset));
}
test('exact opaque bin consumption is independent of chunks and seekability', async () => {
  const payload = new Uint8Array(8192);
  for (let i = 0; i < payload.length; i++) payload[i] = [123,125,92,0,13,10,9][i % 7]!;
  const prefix = enc.encode('{\\rtf1 BEFORE\\bin8192 '), suffix = enc.encode('AFTER}');
  const bytes = new Uint8Array(prefix.length + payload.length + suffix.length);
  bytes.set(prefix); bytes.set(payload, prefix.length); bytes.set(suffix, prefix.length + payload.length);
  for (const size of [1,2,7,2047,2048,2049,83]) assert.equal(await text(bytes, size), 'BEFOREAFTER');
});
test('hex, escaped braces, raw whitespace and backslash LF use distinct paths', async () => {
  assert.equal(await text("{\\rtf1 a\r\nb\t  c\\{\\}\\\\\\'80\\\nd}"), 'ab c{}\\€\nd');
});
test('CR is ignored throughout text token spelling, but remains a raw binary byte', async () => {
  for (const size of [1,2,7,2048]) {
    assert.equal(await text('{\\rtf\r1 A\\\r\nB}',size), 'A\nB');
    assert.equal(await text('{\\rtf1 BEFORE\\bin3 \r{}AFTER}',size), 'BEFOREAFTER');
    assert.equal(await text('{\\rtf1 BEFORE\\bin3\r{}AFTER}',size), 'BEFOREAFTER');
  }
});
test('uc scoped fallback bytes and surrogate pairs follow standards rather than native token skip', async () => {
  assert.equal(await text('{\\rtf1\\uc2 \\u945 abX{\\uc0\\u946 }\\u947 cdY}'), 'αXβγY');
  assert.equal(await text('{\\rtf1\\u-10179 ?\\u-8704 ?}'), '😀');
  assert.equal(await text("{\\rtf1\\uc2\\u945\\'3f\\?X}"), 'αX');
});
test('font cpg overrides charset and group restoration preserves encoding', async () => {
  assert.equal(await text("{\\rtf1\\ansi{\\fonttbl{\\f0\\fcharset204\\cpg1252 Arial;}{\\f1\\fcharset204 Cyrillic;}}\\f0\\'80{\\f1\\'c0}\\'80}"), '€А€');
});
test('plain restores default-font encoding and group close restores selected encoding', async () => {
  assert.equal(await text("{\\rtf1\\deff0{\\fonttbl{\\f0\\cpg1252 Arial;}{\\f1\\cpg1251 Cyrillic;}}\\f1\\'c0{\\plain\\'80}\\'c0}"), 'А€А');
});
test('plain rejects an incomplete prior encoding while retaining the valid prefix', async () => {
  let prefix = '';
  await assert.rejects(async () => {
    for await (const event of extractRtf(chunks("{\\rtf1{\\fonttbl{\\f0\\cpg932 Japanese;}}\\f0\\'41\\'82\\plain X}"), options()))
      if (event.kind === 'text') prefix += event.text;
  }, (e:unknown) => e instanceof UnrtfError && e.code === 'E_ENCODING');
  assert.equal(prefix, 'A');
});
test('objects, links and starred destinations are inert; field results survive', async () => {
  assert.equal(await text('{\\rtf1 A{\\object BAD{\\objdata dead}}{\\*\\unknown HIDE}{\\field{\\*\\fldinst HYPERLINK "https://example.invalid"}{\\fldrslt label}}Z}'), 'AlabelZ');
});
test('DBCS valid prefixes are preserved across formatting and buffer boundaries', async () => {
  const input = "{\\rtf1\\ansicpg932 " + "\\'41".repeat(10238) + "\\'82\\b\\'a0}";
  assert.equal(await text(input, 2048), 'A'.repeat(10238) + 'あ');
});
test('incomplete encoding emits valid prefix then structured error', async () => {
  let prefix = '';
  await assert.rejects(async () => {
    for await (const event of extractRtf(chunks("{\\rtf1\\ansicpg932\\'41\\'82}"), options())) if (event.kind === 'text') prefix += event.text;
  }, (e: unknown) => e instanceof UnrtfError && e.code === 'E_ENCODING');
  assert.equal(prefix, 'A');
});
test('unknown codecs and symbol fonts are explicit capabilities', async () => {
  for (const input of ['{\\rtf1\\ansicpg99999 X}', '{\\rtf1{\\fonttbl{\\f0 Symbol;}}\\f0 X}']) {
    await assert.rejects(() => text(input), (e: unknown) => e instanceof UnrtfError && e.code === 'E_CODEC');
  }
});
test('strict syntax failures and budgets are structured', async () => {
  for (const input of ['plain', '{\\rtf1', "{\\rtf1\\'xz}", '{\\rtf1\\bin4 ab}', '{\\rtf1\\bin-1 }', '{\\rtf1\\bin999999999999999999999 }']) await failure(input, 'E_PARSE');
  await failure('{\\rtf1{{x}}}', 'E_LIMIT', {depth:2});
  await failure('{\\rtf1 abc}', 'E_LIMIT', {inputBytes:4});
  await failure('{\\rtf1\\longcontrolword x}', 'E_LIMIT', {tokenBytes:5});
  await failure('{\\rtf1\\bin3 abc}', 'E_LIMIT', {binaryBytes:2});
});
test('cancellation closes the source iterator and remains invocation local', async () => {
  let closed = false;
  const controller = new AbortController();
  async function* source() { try { yield enc.encode('{\\rtf1 '); controller.abort(); yield enc.encode('bad}'); } finally { closed = true; } }
  await assert.rejects(async () => { for await (const token of tokenizeRtf(source(), {limits, signal:controller.signal})) void token; }, (e: unknown) => e instanceof UnrtfError && e.code === 'E_CANCELLED');
  assert.equal(closed, true);
  assert.equal(await text('{\\rtf1 good}'), 'good');
});
test('consumer early return cleans up source', async () => {
  let closed = false;
  async function* source() { try { yield enc.encode('{\\rtf1 ABC}'); } finally { closed = true; } }
  for await (const token of tokenizeRtf(source(), options())) { void token; break; }
  assert.equal(closed, true);
});
test('all accounting dimensions fail closed', async () => {
  for (const [resource, value] of [['tokens',1],['work',1],['retainedBytes',1]] as const) await failure('{\\rtf1 abc}', 'E_LIMIT', {[resource]:value});
  for (const resource of ['decodedBytes','outputBytes','images','imageBytes'] as const) {
    await assert.rejects(async () => {
      for await (const event of extractRtf(chunks('{\\rtf1 X{\\pict\\bin2 ab}}'), {...options(), limits:{...limits,[resource]:0}})) void event;
    }, (e: unknown) => e instanceof UnrtfError && e.code === 'E_LIMIT' && e.resource === resource);
  }
});
test('encoding/font transitions reject pending bytes without losing emitted prefix', async () => {
  for (const boundary of ['\\ansicpg1252', '{X}', 'M']) {
    let prefix = '';
    await assert.rejects(async () => {
      for await (const event of extractRtf(chunks("{\\rtf1\\ansicpg932\\'41\\'82" + boundary + '}'), options())) if (event.kind === 'text') prefix += event.text;
    }, (e:unknown) => e instanceof UnrtfError && e.code === 'E_ENCODING');
    assert.equal(prefix, 'A');
  }
});
test('unsupported profiles fail before reading source', async () => {
  let read = false;
  async function* source() { read = true; yield enc.encode('{\\rtf1 X}'); }
  await assert.rejects(async () => {
    for await (const event of extractRtf(source(), {...options(), profile:'native-legacy'})) void event;
  }, (e:unknown) => e instanceof UnrtfError && e.code === 'E_PROFILE');
  assert.equal(read,false);
});
test('limits are snapshotted for an invocation', async () => {
  const invocationLimits = {...limits};
  async function* source() { yield enc.encode('{\\rtf1 '); invocationLimits.outputBytes = 0; yield enc.encode('X}'); }
  let result = '';
  for await (const event of extractRtf(source(), {limits:invocationLimits,signal:new AbortController().signal})) if (event.kind === 'text') result += event.text;
  assert.equal(result,'X');
});
test('byte token limits apply to hex and symbols too', async () => {
  await failure("{\\rtf1\\'41}", 'E_LIMIT', {tokenBytes:3});
});
test('six observed code pages reconstruct complete hex runs', async () => {
  for (const [page,hex,expected] of [[932,'82a0','あ'],[936,'d6d0','中'],[950,'a4a4','中'],[949,'b0a1','가'],[1251,'c0','А'],[1252,'80','€']] as const) {
    let escaped = '';
    for (let i=0;i<hex.length;i+=2) escaped += "\\'" + hex.slice(i,i+2);
    assert.equal(await text('{\\rtf1\\ansicpg' + page + " \\'41" + escaped + '}',1), 'A'+expected);
  }
});
test('source charset inventory selects admitted codecs or reports unavailable pages', async () => {
  for (const [charset,page,hex,expected] of [
    [0,1252,'80','€'],[1,0,'80','€'],[77,10000,'80','Ä'],[128,932,'82a0','あ'],
    [129,949,'b0a1','가'],[134,936,'d6d0','中'],[136,950,'a4a4','中'],
    [161,1253,'c1','Α'],[162,1254,'d0','Ğ'],[163,1258,'d0','Đ'],[177,1255,'e0','א'],
    [178,1256,'c7','ا'],[186,1257,'c0','Ą'],[204,1251,'c0','А'],[222,874,'a1','ก'],
    [238,1250,'a5','Ą'],[255,1252,'80','€'],
  ] as const) {
    let escaped = '';
    for (let i = 0; i < hex.length; i += 2) escaped += "\\'" + hex.slice(i,i+2);
    assert.equal(await text('{\\rtf1\\deff0{\\fonttbl{\\f0\\fcharset'+charset+' Font;}}'+escaped+'}',1),expected, 'charset '+charset+' / page '+page);
  }
  for (const [charset,page] of [[2,42],[78,10001],[79,10003],[80,10008],[81,10002],
    [83,10005],[84,10004],[85,10006],[86,10081],[87,10021],[88,10029],[89,10007],
    [130,1361],[254,437]] as const) {
    await assert.rejects(() => text('{\\rtf1\\deff0{\\fonttbl{\\f0\\fcharset'+charset+' Font;}}X}'),
      (e:unknown) => e instanceof UnrtfError && e.code === 'E_CODEC' && e.message.includes(page === 437 ? 'ibm437' : String(page)));
  }
});
test('cancellation of a pending pull requests source cleanup', async () => {
  const controller = new AbortController(); let closed = false;
  const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
    next: () => new Promise<IteratorResult<Uint8Array>>(() => { controller.abort(); }),
    return: async () => {closed = true; return {done:true,value:undefined};},
  }; }};
  await assert.rejects(async () => {for await (const event of tokenizeRtf(source,{limits,signal:controller.signal})) void event;}, (e:unknown) => e instanceof UnrtfError && e.code === 'E_CANCELLED');
  assert.equal(closed,true);
});
test('large pulls yield so scheduled cancellation is observable', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),0);
  try {
    await assert.rejects(async () => {for await (const event of tokenizeRtf(chunks('{\\rtf1 '+ 'x'.repeat(100000) +'}',100010),{limits,signal:controller.signal})) void event;}, (e:unknown) => e instanceof UnrtfError && e.code === 'E_CANCELLED');
  } finally {clearTimeout(timer);}
});
test('document encoding controls are admitted explicitly', async () => {
  assert.equal(await text("{\\rtf1\\mac\\'8e}"),'é');
  for (const control of ['pc','pca']) await assert.rejects(() => text('{\\rtf1\\'+control+' X}'), (e:unknown) => e instanceof UnrtfError && e.code === 'E_CODEC');
});
test('color tables and document lists do not leak declaration text', async () => {
  assert.equal(await text('{\\rtf1{\\colortbl;\\red255\\green0\\blue0;}{\\*\\listtable HIDDEN}BODY}'),'BODY');
});
test('original binary sizes survive deterministic randomized chunk boundaries', async () => {
  for (const length of [0,1,2,7,2047,2048,2049]) {
    const prefix = enc.encode('{\\rtf1 L\\bin'+length+' '), suffix = enc.encode('R}');
    const bytes = new Uint8Array(prefix.length+length+suffix.length);
    bytes.set(prefix); bytes.set(suffix,prefix.length+length);
    for (let i=0;i<length;i++) bytes[prefix.length+i] = [0,123,125,92,10,13,9][i%7]!;
    async function* randomChunks() {
      let seed = 12345;
      for (let i=0;i<bytes.length;) {
        seed = (Math.imul(seed,1664525)+1013904223) >>> 0;
        const end = Math.min(bytes.length,i+1+seed%103);
        yield bytes.subarray(i,end); i=end;
      }
    }
    let result='';
    for await (const event of extractRtf(randomChunks(),options())) if (event.kind === 'text') result+=event.text;
    assert.equal(result,'LR');
  }
});

test('binary fallback counts as one character regardless of payload length', async () => {
  assert.equal(await text('{\\rtf1\\uc1\\u945\\bin4 {}\\\u0000X}',1), 'αX');
  assert.equal(await text('{\\rtf1\\uc1\\u945\\b X}'), 'αX');
});
test('character symbols flush incomplete encoding and reject interrupted surrogate pairs', async () => {
  for (const symbol of ['~','_']) {
    await assert.rejects(() => text("{\\rtf1\\ansicpg932\\'82\\" + symbol + "\\'a0}"),
      (e:unknown) => e instanceof UnrtfError && e.code === 'E_ENCODING');
    await assert.rejects(() => text('{\\rtf1\\uc0\\u-10179\\' + symbol + '\\u-8704}'),
      (e:unknown) => e instanceof UnrtfError && e.code === 'E_ENCODING');
  }
  for (const control of ['par','tab','emdash']) {
    await assert.rejects(() => text('{\\rtf1\\uc0\\u-10179\\' + control + '\\u-8704}'),
      (e:unknown) => e instanceof UnrtfError && e.code === 'E_ENCODING');
  }
});
test('source cleanup failure preserves the primary structured parsing error', async () => {
  let closed = false;
  const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
    next: async () => ({done:false,value:enc.encode('plain')}),
    return: async () => {closed = true; throw new Error('cleanup failure');},
  }; }};
  await assert.rejects(async () => {for await (const token of tokenizeRtf(source,options())) void token;},
    (e:unknown) => e instanceof UnrtfError && e.code === 'E_PARSE');
  assert.equal(closed,true);
});

test('ignorable font tables never admit declarations or codecs', async () => {
  const events = [];
  for await (const event of extractRtf(chunks('{\\rtf1{\\*\\fonttbl{\\f7 Symbol;}}BODY}'), options())) events.push(event);
  assert.equal(events.some(event => event.kind === 'font'), false);
  assert.equal(events.filter(event => event.kind === 'text').map(event => event.text).join(''), 'BODY');
  assert.ok(events.some(event => event.kind === 'skipped' && event.destination === 'fonttbl'));
});
test('nested controls cannot disable inherited picture accounting', async () => {
  await assert.rejects(async () => {
    for await (const event of extractRtf(chunks('{\\rtf1{\\pict{\\fonttbl\\bin4 abcd}}}'), {...options(), limits:{...limits,imageBytes:3}})) void event;
  }, (e:unknown) => e instanceof UnrtfError && e.code === 'E_LIMIT' && e.resource === 'imageBytes');
});
test('malformed ignorable destinations fail rather than leak literal content', async () => {
  for (const input of ['{\\rtf1{\\* SECRET}BODY}', '{\\rtf1{\\*}BODY}']) {
    await assert.rejects(() => text(input), (e:unknown) => e instanceof UnrtfError && e.code === 'E_PARSE');
  }
});

test('cross-realm byte streams are accepted, non-byte views and forged tags fail', async () => {
  const { runInNewContext } = await import('node:vm');
  const bytes: Uint8Array = runInNewContext('new Uint8Array([123,92,114,116,102,49,32,79,75,125])');
  async function* source() { yield bytes; }
  let result = '';
  for await (const event of extractRtf(source(), options())) if (event.kind === 'text') result += event.text;
  assert.equal(result, 'OK');
  for (const invalid of [new Uint16Array([123]), new DataView(new ArrayBuffer(2)), Object.defineProperty(new Uint16Array([123]), Symbol.toStringTag, {value:'Uint8Array'})]) {
    async function* invalidSource() { yield invalid as unknown as Uint8Array; }
    await assert.rejects(async () => { for await (const token of tokenizeRtf(invalidSource(), options())) void token; },
      (e:unknown) => e instanceof UnrtfError && e.code === 'E_PARSE');
  }
});

test('font names decode codepage hex and Unicode without leaking declaration text', async () => {
  for (const size of [1,2,7,2048]) {
    const input = "{\\rtf1\\ansicpg1252{\\fonttbl{\\f0\\cpg932 A\\'82\\'a0;}{\\f1\\fcharset204 \\'c0;}{\\f2\\uc1 \\u945 ?;}{\\f3\\uc0 \\u-10179\\u-8704;}}BODY}";
    const names = []; let body = '';
    for await (const event of extractRtf(chunks(input,size),options())) {
      if (event.kind === 'font') names.push(event.font.name);
      if (event.kind === 'text') body += event.text;
    }
    assert.deepEqual(names,['Aあ','А','α','😀']);
    assert.equal(body,'BODY');
  }
});
test('font name encoding truncation and unpaired Unicode fail explicitly', async () => {
  for (const name of ["\\cpg932 A\\'82;", "\\cpg932 A\\'82", '\\uc0\\u-10179;', '\\uc0\\u-8704;']) {
    await assert.rejects(async () => {
      for await (const event of extractRtf(chunks('{\\rtf1{\\fonttbl{\\f0 '+name+'}}}'),options())) void event;
    }, (e:unknown) => e instanceof UnrtfError && e.code === 'E_ENCODING');
  }
});
test('decoded declaration bytes are bounded separately from document output', async () => {
  await assert.rejects(async () => {
    for await (const event of extractRtf(chunks('{\\rtf1{\\fonttbl{\\f0 ABC;}}}'),{...options(),limits:{...limits,decodedBytes:2}})) void event;
  }, (e:unknown) => e instanceof UnrtfError && e.resource === 'decodedBytes');
});

test('font name symbols and binary fallback stay within the declaration', async () => {
  const events = [];
  for await (const event of extractRtf(chunks('{\\rtf1{\\fonttbl{\\f0 A\\~B\\_C\\uc1\\u945\\bin3 {x};}}BODY}'),options())) events.push(event);
  assert.deepEqual(events.filter(event => event.kind === 'font').map(event => event.font.name),['A\u00a0B\u2011Cα']);
  assert.equal(events.filter(event => event.kind === 'text').map(event => event.text).join(''),'BODY');
});

test('font metadata consumes no document output and preserves literal replacement content', async () => {
  const names = [];
  for await (const event of extractRtf(chunks("{\\rtf1{\\fonttbl{\\f0\\cpg65001\\'ef\\'bf\\'bd;}}}"),{...options(),limits:{...limits,outputBytes:0}})) {
    if (event.kind === 'font') names.push(event.font.name);
    assert.notEqual(event.kind,'text');
  }
  assert.deepEqual(names,['�']);
  await assert.rejects(async () => {
    for await (const event of extractRtf(chunks('{\\rtf1{\\fonttbl{\\f0 A\\bin1 X;}}}'),options())) void event;
  }, (e:unknown) => e instanceof UnrtfError && e.code === 'E_PARSE');
});

test('large Node inputs yield without scheduling a timer per checkpoint', async (t) => {
  const timer = t.mock.method(globalThis,'setTimeout', () => { throw new Error('unexpected timer yield'); });
  try {
    let count = 0;
    for await (const event of tokenizeRtf(chunks('{\\rtf1 '+ 'x'.repeat(9000) +'}',9010),{signal:new AbortController().signal})) {
      if (event.kind === 'byte') count++;
    }
    assert.equal(count,9000);
    assert.equal(timer.mock.callCount(),0);
  } finally { timer.mock.restore(); }
});
