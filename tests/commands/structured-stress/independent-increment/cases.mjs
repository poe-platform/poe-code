const cases = [];
const add = (id, category, input, filter, flags = ['-c'], extra = {}) => {
  cases.push({ id, category, argv: [...flags, '--', filter], inputHex: Buffer.from(input).toString('hex'), ...extra });
};

for (const [label, input] of [
  ['vacant', '{}'],
  ['ordered', '{"z":false,"2":null,"1":7,"__proto__":true}'],
]) {
  for (const filter of ['any(empty)', 'all(empty)', 'any', 'all', 'any(. == 7)', 'all(. != null)', 'any(.[]; . == 7)', 'all(.[]; . != null)']) {
    add(`object-${label}-${filter}`, 'object-iteration', input, filter);
  }
  add(`object-${label}-optional-empty`, 'object-iteration', input, '[any(empty)?,all(empty)?]');
}
for (const [id, input, filter] of [
  ['short-any', '{"first":true,"later":0}', 'any(if . == true then true else 1/0 end)'],
  ['short-all', '{"first":false,"later":0}', 'all(if . == false then false else 1/0 end)'],
  ['empty-condition-array', '[1,2]', '[any(empty),all(empty)]'],
]) add(id, 'object-iteration', input, filter);

for (const [id, token] of [
  ['scale', '12.3400'], ['positive-exponent', '42e+02'], ['negative-exponent', '42e-09'],
  ['negative-zero', '-0'], ['negative-zero-scale', '-0.000'], ['exponent-zero', '0e-10'],
  ['large-integer', '9007199254740993'], ['long-fraction', '0.123456789012345678901'],
  ['large-magnitude', '123456789012345678901234567890'], ['overflow', '1e400'],
  ['underflow', '1e-400'], ['binary-rounding', '1.0000000000000001'],
]) {
  add(`number-${id}-identity`, 'numeric-identity', token, '.');
  add(`number-${id}-conversion`, 'numeric-conversion', token, '[tojson,tostring,([.]|join("|"))]');
  add(`number-${id}-length`, 'numeric-length', token, 'length');
}
for (const [id, input, filter] of [
  ['literal-scale', 'null', '[12.3400,42e+02,-0.000,9007199254740993]'],
  ['arithmetic-rounding', '9007199254740993', '[., .+0, .-0, .*1, ./1]'],
  ['signed-arithmetic-zero', '-0', '[., .+0, .*1, -.]'],
  ['small-double', 'null', '[1/30000000,1/1000000,1/10000000]'],
  ['large-double', 'null', '[99999999999999999999+0,1e21+0]'],
  ['copy-nested', '{"n":12.3400,"a":[42e+02,9007199254740993]}', '{copy:.,field:.n,array:.a}'],
  ['update-unrelated', '{"keep":9007199254740993,"change":12.3400}', '.change += 1'],
  ['decimal-equality', '[9007199254740992,9007199254740993]', '.[0] == .[1]'],
  ['decimal-order', '[0.123456789012345678900,0.123456789012345678901]', '.[0] < .[1]'],
  ['decimal-unique', '[9007199254740993,9007199254740992]', 'unique'],
  ['tonumber', '"12.3400"', 'tonumber'],
  ['fromjson', '"{\"n\":9007199254740993}"', 'fromjson'],
]) add(id, 'numeric-transform', input, filter);
add('argjson-precision', 'numeric-transform', '', '$number', ['-nc', '--argjson', 'number', '9007199254740993']);

for (const [id, input, filter, flags] of [
  ['unicode-records', 'A😀\r\n雪\n\nlast', '[.,length]', ['-Rc']],
  ['unicode-join', 'A😀\r\n雪\n\nlast', '.', ['-Rj']],
  ['unicode-slurp', 'A😀\r\n雪\n\nlast', '[.]|join("!")', ['-Rsj']],
  ['raw-empty-record', '\n', '.', ['-Rc']],
  ['raw-empty-slurp', '', '.', ['-Rsc']],
  ['raw-empty-stream', '', '.', ['-Rce']],
  ['raw-nul', 'a\0b\r\n\0', '.', ['-Rj']],
  ['raw-bom', '\ufeffone\n\ufefftwo', '.', ['-Rc']],
  ['join-mixed', '["😀",null,true,12.5,"\u0000"]', 'join(("\n","|"))', ['-j']],
  ['join-object-order', '{"9":"z","1":"a","__proto__":"p","tail":null}', 'join("/")', ['-j']],
  ['join-json-output', '["a","b"]', 'join(("|","/")),{ok:true}', ['-jc']],
  ['join-exit-last-false', 'null', '"prefix",false', ['-nje']],
  ['join-exit-empty', '[]', 'join(empty)', ['-je']],
  ['json-multibyte', '"A😀雪"\n{"é":"𝄞"}\n', '.', ['-c']],
]) add(id, 'raw-join', input, filter, flags, { chunkProbe: true });

for (const [id, input, filter, flags] of [
  ['separator-empty-prunes-error', '[{},"x"]', '[join(empty)]', ['-c']],
  ['separator-error-after-prefix', '["p","q"]', 'join(("/",1/0,"!"))', ['-j']],
  ['separator-error-caught', '["p","q"]', '[join(("/",1/0,"!"))?]', ['-c']],
  ['separator-limit-lazy', '["p","q"]', 'limit(1;join(("/",1/0)))', ['-j']],
  ['separator-first-empty', '[]', 'first(join(("/",1/0)))', ['-j']],
  ['cartesian-generators', '[["a","b"],["c","d"]]', '[.[]|join(("/","!"))|[.,length]]', ['-c']],
  ['recover-following-json', '["ok"]\n[{}]\n["after"]\n', 'join("|")', ['-j']],
  ['recover-following-json-exit', '["ok"]\n[{}]\n["after"]\n', 'join("|")', ['-je']],
  ['recover-following-raw', 'ok\nbad\nafter\n', 'if . == "bad" then 1/0 else [.]|join("|") end', ['-Rj']],
  ['recover-final-error', '["ok"]\n[{}]\n', 'join("|")', ['-j']],
  ['recover-internal-generator', '["p","q"]\n["r","s"]\n', 'join(("/",1/0,"!"))', ['-j']],
  ['parse-error-after-prefix', '["p","q"]\n{"broken":\n', 'join("/")', ['-j']],
]) add(id, 'error-ordering', input, filter, flags, { chunkProbe: id.startsWith('recover') || id.startsWith('parse-error') });

for (const [id, hex, flags] of [
  ['raw-lone-continuation', '6f6b0a8061667465720a', ['-Rc']],
  ['raw-truncated', '6f6b0af09f', ['-Rj']],
  ['raw-surrogate', '6f6b0aeda0800a61667465720a', ['-Rc']],
  ['raw-overlong-slurp', '61c080620a', ['-Rsc']],
  ['raw-bad-continuation', 'e282410a', ['-Rc']],
  ['json-bad-string', '226f6b220a2280220a226166746572220a', ['-c']],
  ['json-truncated-string', '2261f09f220a', ['-c']],
  ['json-low-surrogate-escape', '225c7564656164220a', ['-c']],
  ['json-high-surrogate-escape', '225c7564383030220a', ['-c']],
]) add(id, 'utf8', Buffer.from(hex, 'hex'), '.', flags, { chunkProbe: true });

add('raw-file-record-boundary', 'file-boundary', '', '.', ['-Rc'], {
  files: { 'first.txt': Buffer.from('left😀').toString('hex'), 'second.txt': Buffer.from('right\nlast').toString('hex') },
  operands: ['first.txt', 'second.txt'],
});
add('raw-file-utf8-boundary', 'file-boundary', '', '.', ['-Rc'], {
  files: { 'first.txt': '41f09f', 'second.txt': '98800a42' }, operands: ['first.txt', 'second.txt'],
});
add('raw-repeated-stdin', 'file-boundary', 'x\ny', '.', ['-Rc'], { operands: ['-', '-'] });

export const probeCases = cases.flatMap(fixture => {
  const { chunkProbe, operands = [], ...rest } = fixture;
  const base = { ...rest, argv: [...rest.argv, ...operands], transport: 'whole' };
  return chunkProbe ? [base, { ...base, id: `${base.id}:bytewise`, transport: 'bytewise' }] : [base];
});

export const pipelineCases = [
  { id: 'pipe-raw-select-join', category: 'pipeline', inputHex: Buffer.from('alpha\n\nβeta\nomega').toString('hex'), stages: [
    ['-Rc', '--', 'select(length > 0)|{line:.,size:length}'],
    ['-sc', '--', 'map(select(.size > 3)|.line)'],
    ['-j', '--', 'join(("|","/"))'],
  ] },
  { id: 'pipe-numeric-roundtrip', category: 'pipeline', inputHex: Buffer.from('9007199254740993\n42e+02\n12.3400').toString('hex'), stages: [
    ['-c', '--', '{value:.}'], ['-sc', '--', 'map(.value)'], ['-j', '--', 'join(";")'],
  ] },
  { id: 'pipe-error-recovery', category: 'pipeline', inputHex: Buffer.from('["before"]\n[{}]\n["after"]').toString('hex'), stages: [
    ['-c', '--', 'join("/")'], ['-sj', '--', 'join("|")'],
  ] },
];
