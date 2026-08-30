export interface InputCase { readonly id: string; readonly argv: readonly string[]; readonly input: string }

export function independentCases(): InputCase[] {
  const cases: InputCase[] = [];
  const add = (id: string, input: string, filter: string, flags: readonly string[] = []) => cases.push({ id, input, argv: ["-c", ...flags, "--", filter] });
  const jobs = '{"jobs":[{"name":"build","ok":true,"ms":7},{"name":"test","ok":false,"ms":3},{"name":"deploy","ok":true,"ms":0}],"meta":{"owner":"🦊","missing":null}}';
  for (const [index, filter] of [
    '.jobs|map(select(.ok)|{name,ms})', '.jobs|map(.ms)|add', '.jobs|sort_by(.ms)|reverse|map(.name)',
    '.jobs|group_by(.ok)|map({ok:.[0].ok,n:length})', '.jobs|map(select(.ms>0))|length',
    '.jobs|any(.ok)', '.jobs|all(.ok)', '.meta|with_entries(select(.value!=null))',
    '.jobs|map({key:.name,value:.ms})|from_entries', '[.jobs[]|select(.name=="build").ms]',
    '.jobs|map(.missing//"fallback")', '{names:[.jobs[].name],owner:.meta.owner}',
  ].entries()) add(`agent-query-${index}`, jobs, filter);
  for (const [index, filter] of [
    '[empty, null, false, 0, "", [], {}]', '[(empty,null,false)//(0,1)]', '[(false,0,null,2)//3]',
    '[select((false,true,true))]', '[if (true,false) then (1,2) else empty end]',
    '[true or (1/0),false and (1/0)]', '[null|(values,scalars,nulls)]', '[first(empty),last(empty)]',
    '[limit(2;range(1000000))]', '[range(3;0;-1)]', '[range(0;4;0)]',
    '[(1,2)+(3,4)]', '[(("x","")*(0,0.9,2))]', '[("a,b,,c"/","),("😀a"/"")]',
    '[(-7%3),(7%-3),(7%2.5)]', '[1/0?]', '[first((1,1/0))]',
  ].entries()) add(`composition-${index}`, "null", filter);
  const object = '{"9":"nine","2":"two","__proto__":{"polluted":true},"constructor":null,"prototype":false,"":"empty","😀":"astral","é":"accent","a\\nb":"line"}';
  for (const [index, filter] of [
    '.', 'keys', 'keys_unsorted', '[.[]]', 'to_entries|from_entries', 'with_entries(.)',
    '.+{"__proto__":0}', '.constructor=1', '.["prototype"]|=empty',
    '[has("__proto__"),has("toString"),.toString]', 'tojson|fromjson',
    '{("__proto__","constructor"):(0,1)}',
  ].entries()) add(`object-keys-${index}`, object, filter);
  const text = '"A😀é\\n\\t\\u0000\\"\\\\Z"';
  for (const [index, filter] of ['.', 'length', '.[1:3]', '.[-3:]', '.[:0]', '.[null:null]', 'tojson|fromjson', 'tostring', './""'].entries()) add(`unicode-${index}`, text, filter);
  for (const [index, input] of ['-0', '-1.25', '2147483648', '9007199254740991', '0.125', '[]', '{}', 'true', 'false', 'null', '""'].entries()) add(`scalar-${index}`, input, '.');
  add('raw-output-escaped-argument', 'null', '$value', ['-r', '--arg', 'value', '😀\n\t"\\']);
  add('json-argument-prototype', 'null', '[$value,$ARGS.named]', ['--argjson', 'value', '{"__proto__":1,"constructor":2}']);
  add('empty-variable-name', 'null', '$ARGS', ['--arg', '', 'empty']);
  add('explicit-ARGS', 'null', '$ARGS', ['--arg', 'ARGS', 'override']);
  add('duplicate-named-binding', 'null', '$value', ['--arg', 'value', 'first', '--argjson', 'value', '2']);
  for (const [index, input] of ['', 'false\nnull\n0', '0\nfalse', 'null\nnull', '""\n[]\n{}'].entries()) {
    add(`exit-last-${index}`, input, '.', ['-e']);
    add(`exit-filtered-${index}`, input, 'select(.!=null)', ['-e']);
    add(`slurp-${index}`, input, '.', ['-s']);
  }
  add('null-ignores-invalid-input', '[broken', '.', ['-n', '-s']);
  add('raw-output-types', '"line\\nnext"\nfalse\nnull\n7\n{}', '.', ['-r']);
  let seed = 0x93ade117;
  const random = (maximum: number): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
  for (let round = 0; round < 24; round++) {
    const entries = Array.from({ length: 5 }, (_, index) => ({ name: `task-${index}`, score: random(13) - 6, active: random(3) !== 0, group: random(3) }));
    const input = JSON.stringify(entries);
    add(`seeded-agent-${round}`, input, 'map(select(.active and .score>=0)|{name,score})|sort_by(.score,.name)');
    add(`seeded-group-${round}`, input, 'group_by(.group)|map({group:.[0].group,total:map(.score)|add})');
    add(`seeded-update-${round}`, input, '.[0,2].score += (1,-1)');
    const matrix = JSON.stringify(Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => random(31) - 15)));
    add(`seeded-indices-${round}`, matrix, '[.[(0,2)][(0,2,-1)]]');
    add(`seeded-delete-${round}`, matrix, '(.[0][1],.[2][0],.[9][3]) |= empty');
  }
  return cases;
}
