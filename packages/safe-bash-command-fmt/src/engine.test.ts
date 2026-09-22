import assert from 'node:assert/strict';
import test from 'node:test';
import { createFmtEngine, parseFmtArguments, FmtError, type FmtLimits } from './index.js';

const encoder = new TextEncoder();
const limits: FmtLimits = { inputBytes: 100_000, outputBytes: 200_000, retainedBytes: 20_000, work: 10_000_000, argumentBytes: 4096 };
const argv = (...args: string[]): Uint8Array[] => args.map(arg => encoder.encode(arg));
function format(input: string | Uint8Array, args: string[] = [], chunkSize = 4096): Uint8Array {
  const engine = createFmtEngine(parseFmtArguments(argv(...args), { limits }), limits, new AbortController().signal);
  const machine = engine.run();
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  const output: Uint8Array[] = [];
  let offset = 0, step = machine.next();
  while (!step.done) {
    if (step.value === 'input') {
      const chunk = offset === bytes.length ? null : bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
      offset += chunk?.length ?? 0;
      step = machine.next(chunk);
    } else {
      if (step.value) output.push(step.value);
      step = machine.next();
    }
  }
  assert.ok(engine.accounting().peakRetainedBytes <= limits.retainedBytes);
  assert.equal(engine.accounting().retainedBytes, 0);
  const result = new Uint8Array(output.reduce((sum, chunk) => sum + chunk.length, 0));
  let position = 0;
  for (const chunk of output) { result.set(chunk, position); position += chunk.length; }
  return result;
}
function expectBytes(input: string | Uint8Array, args: string[], expected: string | Uint8Array): void {
  for (const chunkSize of [1, 37, 4096]) assert.deepEqual(format(input, args, chunkSize), typeof expected === 'string' ? encoder.encode(expected) : expected);
}

test('released 9.10 gate: width excludes LF and uses optimal breaks', () => {
  expectBytes('aa bb cc dd ee', ['-w8'], 'aa bb cc\ndd ee\n');
  expectBytes('aa bb cc dd ee', ['-w7'], 'aa\nbb cc\ndd ee\n');
  expectBytes('one two three four five', ['-w20'], 'one two three\nfour five\n');
});
test('released upstream goal-option control exercises sentence and punctuation costs', () => {
  // Exact input/output from the authenticated 9.10 tests/fmt/goal-option.sh;
  // these are source fixtures, not newly executed native observations.
  const input = `
@command{fmt} prefers breaking lines at the end of a sentence, and tries to
avoid line breaks after the first word of a sentence or before the last word
of a sentence.  A @dfn{sentence break} is defined as either the end of a
paragraph or a word ending in any of @samp{.?!}, followed by two spaces or end
of line, ignoring any intervening parentheses or quotes.  Like @TeX{},
@command{fmt} reads entire ''paragraphs'' before choosing line breaks; the
algorithm is a variant of that given by
Donald E. Knuth and Michael F. Plass
in ''Breaking Paragraphs Into Lines'',
@cite{Software---Practice & Experience}
@b{11}, 11 (November 1981), 1119--1184.
`;
  const expected = `
@command{fmt} prefers breaking lines at the end of a sentence,
and tries to avoid line breaks after the first word of a sentence
or before the last word of a sentence.  A @dfn{sentence break}
is defined as either the end of a paragraph or a word ending
in any of @samp{.?!}, followed by two spaces or end of line,
ignoring any intervening parentheses or quotes.  Like @TeX{},
@command{fmt} reads entire ''paragraphs'' before choosing line
breaks; the algorithm is a variant of that given by Donald
E. Knuth and Michael F. Plass in ''Breaking Paragraphs Into
Lines'', @cite{Software---Practice & Experience} @b{11}, 11
(November 1981), 1119--1184.
`;
  expectBytes(input, ['-g60', '-w72'], expected);
});
test('released upstream long-line control crosses the word window in split-only mode', () => {
  expectBytes(' y'.repeat(1015) + '\n', ['-s'], ' y'.repeat(35).concat('\n').repeat(29));
});
test('ASCII whitespace and encoded byte length preserve Unicode and invalid words', () => {
  // The cost of beginning the last line with a final word favors the shorter first line.
  expectBytes('é é é', ['-w5'], 'é\né é\n');
  expectBytes('a\u2003b c\u00a0d', ['-w1'], 'a\u2003b\nc\u00a0d\n');
  expectBytes(Uint8Array.of(255, 32, 32, 254), ['-u'], Uint8Array.of(255, 32, 254, 10));
  // get_line uses c_isspace, but get_space consumes only SPACE/TAB. Other
  // whitespace starts the next token; uniform mode inserts spaces before it.
  expectBytes('a\vb\fc\rd', ['-u'], 'a \vb \fc \rd\n');
});
test('blank boundaries, indentation, prefix requirements and unmatched missing LF', () => {
  expectBytes('a\nb\n\n\n  c\n  d\ne', [], 'a b\n\n\n  c d\ne\n');
  expectBytes('> a\n> b\n>\nother', ['-p', '> '], '> a b\n>\nother');
  expectBytes('fo\nfoo a\nfoo b', ['-pfoo'], 'fo\nfoo a b\n');
  expectBytes('> a\n  > b\n  > c', ['-p', '  > '], '> a\n  > b c\n');
});
test('spacing keeps sentences, closing quotes and file-wide tab conversion', () => {
  expectBytes('a   b.    c!\n d', ['-u'], 'a b.  c!\n d\n');
  expectBytes('a.)"   b', ['-u'], 'a.)"  b\n');
  expectBytes('a\tb\tc', [], 'a\tb\tc\n');
  expectBytes('a\tb\tc', ['-u'], 'a b c\n');
  expectBytes('\ta\n        b', [], '\ta b\n');
});
test('split > crown > tagged precedence and tagged other-indent carry', () => {
  expectBytes('a b\n  c d\n  e f', ['-c', '-t'], 'a b c d e f\n');
  expectBytes('a b\n  c d', ['-s', '-c', '-t'], 'a b\n  c d\n');
  expectBytes('a\n  b\n\nlong word tail', ['-t', '-w10'], 'a b\n\nlong word\n  tail\n');
});
for (const count of [4998, 4999, 5000, 5001, 5002, 9998, 9999, 10000, 10001, 10002]) {
  test(`released MAXCHARS raw-flush behavior at ${count} bytes`, () => {
    const raw = 'A'.repeat(Math.floor((count - 1) / 5000) * 5000);
    const tail = 'A'.repeat(count - raw.length);
    const expected = tail.length > 20 ? `${raw}> ${tail}\n> end\n` : `${raw}> ${tail} end\n`;
    expectBytes(`> ${'A'.repeat(count)} end`, ['-p', '> ', '-w20'], expected);
  });
}
test('released MAXWORDS flush retains suffix and previous length (not whole-paragraph DP)', () => {
  // Exact byte recipe: 999 ASCII a words separated by one space, terminal LF.
  const line = (count: number): string => Array(count).fill('a').join(' ') + '\n';
  expectBytes(line(999), ['-w17'], line(8) + line(9).repeat(109) + line(8) + line(2));
});
for (const mode of ['', '-u', '-c', '-t']) {
  test(`source-qualified MAXCHARS margin matrix: ${mode || 'default'}`, () => {
    // Derived from authenticated 9.10 get_line/flush_paragraph/put_line, not
    // generated by the candidate or claimed as captured native transcripts.
    const profiles = [
      { leading: '', indent: 0, tagged: '   ', prefix: false },
      { leading: '        ', indent: 8, tagged: '', prefix: false },
      { leading: '\t', indent: 8, tagged: '', prefix: false },
      { leading: '> ', indent: 2, tagged: '>', prefix: true },
      { leading: '  > ', indent: 4, tagged: '  >', prefix: true },
    ];
    for (const count of [4998, 4999, 5000, 5001, 5002, 9998, 9999, 10000, 10001, 10002]) {
      for (const profile of profiles) {
        const rawLength = Math.floor((count - 1) / 5000) * 5000;
        const raw = 'A'.repeat(rawLength), tail = 'A'.repeat(count - rawLength);
        // If the final word crosses MAXCHARS, multiword flush emits A first;
        // the retained end word then starts a new window with first_indent.
        const second = mode === '-t' && tail.length + 3 <= 5000 ? profile.tagged : profile.leading;
        const expected = profile.indent + tail.length + 4 <= 20
          ? `${raw}${profile.leading}${tail} end\n`
          : `${raw}${profile.leading}${tail}\n${second}end\n`;
        const args = ['-w20', ...(mode ? [mode] : []), ...(profile.prefix ? ['-p', '> '] : [])];
        expectBytes(`${profile.leading}${'A'.repeat(count)} end`, args, expected);
      }
    }
  });
}
for (const count of [996, 997, 998, 1000, 1001, 1002, 1003, 1004]) {
  test(`released all-a exact word-window bytes at ${count} words, width17`, () => {
    const line = (words: number): string => Array(words).fill('a').join(' ') + '\n';
    // Given the observed line counts and <=9 words per width17 line, the
    // supplied boundary deficits determine every remaining nine-word line.
    const short = 999 - count;
    const expected = count < 999 ? line(8).repeat(short) + line(9).repeat(111 - short)
      : line(8) + line(9).repeat(109) + line(8) + line(count - 997);
    expectBytes(line(count), ['-w17'], expected);
  });
}

test('parser defaults, goal-only validation, numbers, abbreviations and repeated options', () => {
  const defaults = parseFmtArguments([]);
  assert.equal(defaults.width, 75); assert.equal(defaults.goal, 70);
  for (const text of ['0', '+5', '05', ' 5']) assert.equal(parseFmtArguments(argv('-w', text)).width, Number(text));
  assert.equal(parseFmtArguments(argv('--wid=20')).width, 20);
  assert.equal(parseFmtArguments(argv('-123')).width, 123);
  const goal = parseFmtArguments(argv('-g0', '-g20'));
  assert.equal(goal.width, 30); assert.equal(goal.goal, 20);
  for (const args of [['-g76'], ['-w2501'], ['-g20', '-w10'], ['-w10', '-g20'], ['-c', '-20']]) assert.throws(() => parseFmtArguments(argv(...args)), FmtError);
  for (const width of ['0', '1', '2']) expectBytes('long words', ['-w', width], 'long\nwords\n');
});
test('parser owns prefix and operand bytes and limits encoded arguments', () => {
  const args = argv('-p', '  > ', 'é');
  const options = parseFmtArguments(args);
  args[1]!.fill(0); args[2]!.fill(0);
  assert.deepEqual(options.prefix, encoder.encode('>'));
  assert.equal(options.leading, 2); assert.equal(options.fullPrefix, 2);
  assert.deepEqual(options.files[0]!.bytes, encoder.encode('é'));
  assert.throws(() => parseFmtArguments(argv('é'), { limits: { ...limits, argumentBytes: 1 } }), { code: 'LIMIT' });
});
test('explicit profile rejects unavailable locale/decoder semantics', () => {
  assert.throws(() => parseFmtArguments([], { profile: 'host-locale' as never }), { code: 'PROFILE' });
});
test('released numeric diagnostics distinguish imposed width range from goal result range', () => {
  // fmt.c passes XTOINT_MAX_RANGE for width, but not for goal (xdectoint.c).
  for (const value of ['2501', '1073741824', '18446744073709551616']) {
    assert.throws(() => parseFmtArguments(argv('-w', value)), {
      code: 'WIDTH', message: `invalid width: '${value}': Numerical result out of range`,
    });
  }
  for (const args of [['-g76'], ['-g20', '-w10'], ['-w10', '-g20']]) {
    const value = args.includes('-g76') ? '76' : '20';
    assert.throws(() => parseFmtArguments(argv(...args)), {
      code: 'WIDTH', message: `invalid width: '${value}': Value too large for defined data type`,
    });
  }
  assert.throws(() => parseFmtArguments(argv('-w1073741824x')), {
    code: 'WIDTH', message: "invalid width: '1073741824x'",
  });
  assert.equal(parseFmtArguments(argv('-wbad', '-w20', '-gbad', '-g10')).goal, 10);
  assert.throws(() => parseFmtArguments(argv('-g76'), { profile: 'gnu-coreutils-8.30-C-bytes' }), {
    message: "invalid width: '76': Numerical result out of range",
  });
});
test('historical 8.30 profile has an explicit separate width gate', () => {
  const options = parseFmtArguments(argv('-w8'), { profile: 'gnu-coreutils-8.30-C-bytes' });
  const engine = createFmtEngine(options, limits, new AbortController().signal);
  const machine = engine.run();
  assert.equal(machine.next().value, 'input');
  let step = machine.next(encoder.encode('aa bb cc dd ee'));
  while (!step.done && step.value !== 'input') step = machine.next();
  assert.equal(step.value, 'input');
  step = machine.next(null);
  while (!step.done && !step.value) step = machine.next();
  assert.deepEqual(step.value, encoder.encode('aa\nbb cc\ndd ee\n'));
  machine.next();
});
test('engine checks input/output/work/retention, closes after failure and cancellation', () => {
  for (const override of [{ inputBytes: 0 }, { outputBytes: 0 }, { work: 0 }]) {
    const engine = createFmtEngine(parseFmtArguments([]), { ...limits, ...override }, new AbortController().signal);
    const machine = engine.run();
    assert.throws(() => {
      let step = machine.next();
      while (!step.done) step = machine.next(step.value === 'input' ? encoder.encode('a') : undefined);
    }, { code: 'LIMIT' });
    assert.equal(engine.accounting().retainedBytes, 0);
    assert.throws(() => engine.run().next(), { code: 'CLOSED' });
  }
  assert.throws(() => createFmtEngine(parseFmtArguments([]), { ...limits, retainedBytes: 1 }, new AbortController().signal), { code: 'LIMIT' });
  const controller = new AbortController();
  const engine = createFmtEngine(parseFmtArguments([]), limits, controller.signal);
  const machine = engine.run(); machine.next(); controller.abort();
  assert.throws(() => machine.next(encoder.encode('a')), { code: 'CANCELLED' });
  assert.equal(engine.accounting().retainedBytes, 0);
});
test('producer reuse cannot mutate retained input and disposal is idempotent', () => {
  const engine = createFmtEngine(parseFmtArguments([]), limits, new AbortController().signal);
  const machine = engine.run(); assert.equal(machine.next().value, 'input');
  const input = encoder.encode('one two');
  assert.equal(machine.next(input).value, 'input'); input.fill(120);
  const step = machine.next(null);
  assert.deepEqual(step.value, encoder.encode('one two\n'));
  machine.next(); engine.dispose(); engine.dispose();
  assert.equal(engine.accounting().retainedBytes, 0);
});
test('empty input resumptions are metered and stop without retaining a source', () => {
  const engine = createFmtEngine(parseFmtArguments([]), { ...limits, work: 5 }, new AbortController().signal);
  const machine = engine.run(); machine.next();
  assert.throws(() => { for (let i = 0; i < 10; i++) machine.next(new Uint8Array()); }, { code: 'LIMIT' });
  assert.equal(engine.accounting().retainedBytes, 0);
});
test('input copy work is admitted before allocating an owned chunk', () => {
  const engine = createFmtEngine(parseFmtArguments([]), { ...limits, work: 10 }, new AbortController().signal);
  const machine = engine.run(); machine.next();
  assert.throws(() => machine.next(encoder.encode('a'.repeat(100))), { code: 'LIMIT' });
  assert.equal(engine.accounting().inputBytes, 0);
  assert.equal(engine.accounting().retainedBytes, 0);
});
test('accounting distinguishes opaque input from decoded storage and counts formatted LF', () => {
  const engine = createFmtEngine(parseFmtArguments([]), limits, new AbortController().signal);
  const machine = engine.run();
  assert.equal(engine.accounting().decodedBytes, 0);
  assert.equal(machine.next().value, 'input');
  let step = machine.next(Uint8Array.of(255, 32, 254));
  while (!step.done) step = machine.next(step.value === 'input' ? null : undefined);
  const counters = engine.accounting();
  assert.equal(counters.inputBytes, 3);
  assert.equal(counters.decodedBytes, 0);
  assert.equal(counters.outputBytes, 4);
  assert.equal(counters.retainedBytes, 0);
  assert.ok(counters.work >= counters.inputBytes + counters.outputBytes);
  assert.equal(counters.peakRetainedBytes, 5000 + 4096 + 1024);
});
test('engine checks cancellation before admitting input after a suspended request', () => {
  const controller = new AbortController();
  const engine = createFmtEngine(parseFmtArguments([]), limits, controller.signal);
  const machine = engine.run(); machine.next(); controller.abort();
  assert.throws(() => machine.next(null), { code: 'CANCELLED' });
  assert.equal(engine.accounting().retainedBytes, 0);
});
test('an already cancelled invocation never acquires engine buffers', () => {
  const controller = new AbortController(); controller.abort();
  assert.throws(() => createFmtEngine(parseFmtArguments([]), limits, controller.signal), { code: 'CANCELLED' });
});
test('cancellation while the receiver writes final output is checked before completion', () => {
  for (const length of [1, 1023]) {
    const controller = new AbortController();
    const engine = createFmtEngine(parseFmtArguments([]), limits, controller.signal);
    const machine = engine.run();
    assert.equal(machine.next().value, 'input');
    let step = machine.next(encoder.encode('a'.repeat(length)));
    while (!step.done && step.value !== 'input') step = machine.next();
    assert.equal(step.value, 'input');
    step = machine.next(null);
    while (!step.done && !(step.value instanceof Uint8Array)) step = machine.next();
    assert.ok(step.value instanceof Uint8Array);
    assert.equal(step.value.length, length + 1);
    controller.abort();
    assert.throws(() => machine.next(), { code: 'CANCELLED' });
    assert.equal(engine.accounting().retainedBytes, 0);
  }
});
test('cancellation between engine construction and first run releases buffers', () => {
  const controller = new AbortController();
  const engine = createFmtEngine(parseFmtArguments([]), limits, controller.signal);
  controller.abort();
  assert.throws(() => engine.run().next(), { code: 'CANCELLED' });
  assert.equal(engine.accounting().retainedBytes, 0);
});
test('input resumptions reuse admitted storage instead of overlapping chunk allocations', () => {
  const NativeBytes = Uint8Array;
  const chunk = new NativeBytes(4096).fill(97);
  const engine = createFmtEngine(parseFmtArguments([]), limits, new AbortController().signal);
  const machine = engine.run(); machine.next();
  let inputAllocations = 0;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Uint8Array')!;
  Object.defineProperty(globalThis, 'Uint8Array', { ...descriptor, value: new Proxy(NativeBytes, {
    construct(target, args, newTarget) {
      if (args[0] === 4096) inputAllocations++;
      return Reflect.construct(target, args, newTarget);
    },
  }) });
  try {
    for (let i = 0; i < 3; i++) {
      let step = machine.next(chunk);
      while (!step.done && step.value !== 'input') step = machine.next();
      assert.equal(step.value, 'input');
    }
    assert.equal(inputAllocations, 0);
  } finally { Object.defineProperty(globalThis, 'Uint8Array', descriptor); engine.dispose(); }
});

test('unexpected input on output or checkpoint events fails and releases invocation buffers', () => {
  for (const event of ['checkpoint', 'partial-output', 'full-output'] as const) {
    for (const unexpected of [null, encoder.encode('lost input')]) {
      const engine = createFmtEngine(parseFmtArguments([]), limits, new AbortController().signal);
      const machine = engine.run();
      assert.equal(machine.next().value, 'input');
      const input = encoder.encode('a'.repeat(event === 'checkpoint' ? 4096 : event === 'full-output' ? 1023 : 1));
      let step = machine.next(input);
      while (!step.done) {
        if (event === 'checkpoint' ? step.value === undefined : step.value instanceof Uint8Array) break;
        step = machine.next(step.value === 'input' ? null : undefined);
      }
      assert.equal(step.done, false);
      if (event !== 'checkpoint') assert.equal((step.value as Uint8Array).length, input.length + 1);
      assert.throws(() => machine.next(unexpected), { code: 'INPUT' });
      assert.equal(engine.accounting().retainedBytes, 0);
      assert.throws(() => engine.run().next(), { code: 'CLOSED' });
    }
  }
});
