import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";

for (const key of ['k', '10', '01', 'two words']) {
  for (const nounset of ['', 'set -u; ']) {
    test(`associative default and alternate operators: ${key}, ${nounset || 'normal'}`, async () => {
      const { shell } = setup();
      try {
        const result = await shell.exec(`${nounset}declare -A m; key='${key}'; m[$key]=value; m[empty]=''; args "\${m[missing]-fallback}" "\${m[missing]:-fallback}" "\${m[missing]+alt}" "\${m[missing]:+alt}" "\${m[$key]-fallback}" "\${m[$key]:-fallback}" "\${m[$key]+alt}" "\${m[$key]:+alt}" "\${m[empty]-fallback}" "\${m[empty]:-fallback}" "\${m[empty]+alt}" "\${m[empty]:+alt}"; x=\${m[missing]:-fallback}; args "$x"`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, '');
        assert.equal(result.stdout, '["fallback","fallback","","","value","value","alt","alt","","fallback","alt",""]["fallback"]');
      } finally { await shell.dispose(); }
    });
  }
}

for (const [source, expected] of [
  ['args ${m[missing]:-"two words"}', '["two words"]'],
  ['args ${m[k]:+"two words"}', '["two words"]'],
  ['args ${m[missing]-"two words"}', '["two words"]'],
  ['args ${m[k]+"two words"}', '["two words"]'],
  ['args ${m[missing]:-""}', '[""]'],
  ['args ${m[k]:+""}', '[""]'],
  ['args ${m[missing]:-one two}', '["one","two"]'],
  ['args "${m[missing]:-$@}"', '["one","two words"]'],
] as const) test(`associative operand fields: ${source}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(`declare -A m; m[k]=value; set -- one 'two words'; ${source}`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, expected);
  } finally { await shell.dispose(); }
});

test('associative operands are lazy and subscripts expand once', async () => {
  const { shell } = setup();
  let effects = 0;
  shell.register({ name: 'effect', execute() { effects++; return { exitCode: 0 }; } });
  try {
    const result = await shell.exec('set -u; declare -A m; m[k]=value; i=0; args "${m[k]:-$(effect)}" "${m[missing]:+$(effect)}" "${m[$((i+=1))]:-fallback}" "$i"');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, '["value","","fallback","1"]');
    assert.equal(effects, 0);
  } finally { await shell.dispose(); }
});

test('associative operators preserve distinct raw keys and values', async () => {
  const { getCommandArguments } = await import('../../src/contracts/index.js');
  const { shell } = setup();
  shell.register({ name: 'raw', async execute(context) { await context.stdout.write(getCommandArguments(context).bytes(0)!); return { exitCode: 0 }; } });
  try {
    const result = await shell.exec('declare -A m; x=$\'\\377\'; y=$\'\\376\'; m[$x]=$\'\\375\'; raw "${m[$x]:-fallback}"; raw "${m[$y]:-missing}"');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.deepEqual([...result.stdoutBytes], [253, 109, 105, 115, 115, 105, 110, 103]);
  } finally { await shell.dispose(); }
});

for (const [label, source, expected] of [
  ["declaration and literal key", 'declare -A m; m[key]=value; args "${m[key]}"', '["value"]'],
  ["quoted space key", 'declare -A m; m["two words"]=value; args "${m["two words"]}"', '["value"]'],
  ["expanded key", 'declare -A m; key=hello; m[$key]=world; args "${m[$key]}"', '["world"]'],
  ["count and values", 'declare -A m; m[k]=v; args "${#m[@]}" "${m[@]}"', '["1","v"]'],
  ["keys", 'declare -A m; m[k]=v; args "${!m[@]}"', '["k"]'],
  ["unset member", 'declare -A m; m[k]=v; unset "m[k]"; args "${#m[@]}" "${m[k]}"', '["0",""]'],
  ["prototype names", 'declare -A m; m[__proto__]=v; args "${m[__proto__]}"', '["v"]'],
  ["subshell copy", 'declare -A m; m[k]=old; (m[k]=new); args "${m[k]}"', '["old"]'],
  ["compound declaration", 'declare -A m=([foo]=bar [baz]=qux); args "${m[foo]}" "${m[baz]}"', '["bar","qux"]'],
  ["compound replacement and append", 'declare -A m; m[old]=gone; m=([foo]=bar); m+=([b]=2 [foo]+=more); args "${m[old]}" "${m[foo]}" "${m[b]}"', '["","barmore","2"]'],
  ["compound quoted and expanded keys", 'declare -A m; k="two words"; m=(["a]b"]=yes [$k]=space [01]=zero [1]=one); args "${m["a]b"]}" "${m[$k]}" "${m[01]}" "${m[1]}"', '["yes","space","zero","one"]'],
  ["compound arithmetic indices", 'i=2; a=([i]=first [i+1]=second); args "${!a[*]}" "${a[2]}" "${a[3]}"', '["2 3","first","second"]'],
  ["compound arithmetic expression", 'a=([1+2]=three next); args "${a[3]}" "${a[4]}"', '["three","next"]'],
  ["compound entry append", 'a=(x y); a+=([0]+=1 [1]+=2); args "${a[0]}" "${a[1]}"', '["x1","y2"]'],
  ["compound subscript evaluated once", 'i=0; a=([i++]=first [i++]=second); args "$i" "${a[0]}" "${a[1]}"', '["2","first","second"]'],
  ["compound repeated entry append", 'a=([0]=x [0]+=y); args "${a[0]}"', '["xy"]'],
  ["compound expanded bracket key", 'declare -A m; k="a]b"; m=([$k]=yes); args "${m[$k]}"', '["yes"]'],
  ["compound raw key identity", "declare -A m; x=$'\\377'; y=$'\\376'; m=([$x]=first [$y]=second); args \"${m[$x]}\" \"${m[$y]}\"", '["first","second"]'],
  ["compound negative index", 'a=([2]=two [-1]+=more); args "${a[2]}"', '["twomore"]'],
] as const) test(`associative arrays: ${label}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
  } finally { await shell.dispose(); }
});

for (const [label, source, expected] of [
  ["quoted closing bracket", 'declare -A m; m["a]b"]=yes; args "${m["a]b"]}"', '["yes"]'],
  ["numeric strings remain distinct", 'declare -A m; m[01]=a; m[1]=b; m[1+1]=c; args "${m[01]}" "${m[1]}" "${m[1+1]}"', '["a","b","c"]'],
  ["local declaration", 'declare -A m; m[k]=outer; f() { declare -A m; m[k]=inner; args "${m[k]}"; }; f; args "${m[k]}"', '["inner"]["outer"]'],
  ["literal star unset", 'declare -A m; m["*"]=star; m[k]=keep; unset "m[*]"; args "${#m[@]}" "${m[k]}"', '["1","keep"]'],
  ["scalar key zero", 'declare -A m; m[k]=keep; m=zero; args "$m" "${m[0]}" "${m[k]}"', '["zero","zero","keep"]'],
] as const) test(`associative arrays: ${label}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, expected);
  } finally { await shell.dispose(); }
});

test('mapfile refuses associative destination before reading', async () => {
  const { shell } = setup();
  let pulls = 0;
  try {
    const result = await shell.exec('declare -A m; m[k]=old; mapfile -t m; args "$?" "${m[k]}"', { stdin: { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(97, 10); } } });
    assert.equal(result.exitCode, 0);
    assert.equal(pulls, 0);
    assert.equal(result.stdout, '["1","old"]');
  } finally { await shell.dispose(); }
});

test('copied array keys and raw values remain charged until their final owner releases', async () => {
  const { ArrayLedger, ArrayOwner } = await import('../../src/shell/arrays/ledger.js');
  const { IndexedBinding, valueToken } = await import('../../src/shell/arrays/bindings.js');
  const { shellValueFromBytes } = await import('../../src/contracts/value.js');
  const ledger = new ArrayLedger(10000, 1000);
  const owner = ArrayOwner.create(ledger);
  const signal = new AbortController().signal;
  const source = IndexedBinding.create(owner, true);
  let copy: Awaited<ReturnType<typeof source.copy>> | undefined;
  try {
    const index = (await source.keyIndex('key', owner, signal, true))!;
    source.insert(index, await valueToken(source.owner, shellValueFromBytes(Uint8Array.of(255)), signal));
    const key = source.keys.get(source.keyByIndex.get(index)!)!.text;
    const value = source.values.get(index)!.text;
    copy = await source.copy(signal);
    await source.release();
    assert.equal(key.admission.released, false);
    assert.equal(value.admission.released, false);
    await copy.release(); copy = undefined;
    assert.equal(key.admission.released, true);
    assert.equal(value.admission.released, true);
  } finally { await copy?.release(); await owner.close(); }
});

for (const [source, stdout, status] of [
  ['declare -A m; m[""]=bad; say WRONG', '', 1],
  ['declare -A m; args "${m[""]}"; say after', '[""]after\n', 0],
  ['declare -A m; m[k]=old; readonly m; m[k]=new; say WRONG', '', 1],
] as const) test(`associative invalid writes and empty lookup: ${source}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(source);
    assert.equal(result.stdout, stdout);
    assert.equal(result.exitCode, status);
    assert.notEqual(result.stderr, '');
  } finally { await shell.dispose(); }
});

test('unset retains distinct raw associative key identity', async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('declare -A m; x=$\'\\377\'; y=$\'\\376\'; m[$x]=first; m[$y]=second; unset "m[$x]"; args "${#m[@]}" "${m[$y]}"');
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, '["1","second"]');
  } finally { await shell.dispose(); }
});

for (const [label, limits, count, prefix] of [
  ['retained key bytes', { maxExpansionBytes: 4096 }, 60, 'x'.repeat(96)],
  ['key count', { maxExpansionFields: 128 }, 100, 'k'],
] as const) test(`associative arrays bound ${label}`, async () => {
  const { shell } = setup();
  let effects = 0;
  shell.register({ name: 'effect', execute() { effects++; return { exitCode: 0 }; } });
  try {
    const source = 'set -e; declare -A m; ' + Array.from({ length: count }, (_, index) => `m[${prefix}${index}]=v;`).join(' ') + ' effect';
    const result = await shell.exec(source, { limits });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /private (payload|metadata|slot) limit/u);
    assert.equal(effects, 0);
    assert.equal((await shell.exec('effect')).exitCode, 0);
    assert.equal(effects, 1);
  } finally { await shell.dispose(); }
});

test('scalar to associative conversion preserves raw key-zero bytes', async () => {
  const { getCommandArguments } = await import('../../src/contracts/index.js');
  const { shell } = setup();
  shell.register({ name: 'raw', async execute(context) { await context.stdout.write(getCommandArguments(context).bytes(0)!); return { exitCode: 0 }; } });
  try {
    const result = await shell.exec('m=$\'\\377\'; declare -A m; raw "${m[0]}"');
    assert.deepEqual([...result.stdoutBytes], [255]);
  } finally { await shell.dispose(); }
});

test('key enumeration cannot expose values of indexed or scalar bindings', async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('a=([2]=two [7]=seven); scalar=value; args "${!a[@]}" "${!scalar[@]}"');
    assert.equal(result.stdout, '["2","7","0"]');
  } finally { await shell.dispose(); }
});
